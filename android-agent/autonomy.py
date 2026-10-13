"""Long-running, per-device autonomous task supervisor.

No fixed runtime deadline. Runs until stopped, device disconnects, or server shuts down.
State and activity history persist in SQLite. A changed screen triggers a bounded AI cycle.
"""
import hashlib
import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, Field
from visual_agent import app, adb, connected, screenshot, run_task, Task, _cancel, _guard

DB = Path(__file__).with_name("agent_memory.sqlite3")
_workers: dict[str, threading.Thread] = {}
_stops: dict[str, threading.Event] = {}
_lock = threading.RLock()

class StartRequest(BaseModel):
    serial: str = Field(min_length=1, max_length=128)
    goal: str = Field(min_length=1, max_length=2000)
    check_seconds: int = Field(default=45, ge=15, le=3600)
    steps_per_cycle: int = Field(default=8, ge=1, le=25)
    # Sensitive actions are excluded from this initial unattended version.
    # Require explicit trusted-contact policies before enabling outbound messages.
    allow_send_messages: bool = False

class SerialRequest(BaseModel):
    serial: str

def connect():
    db = sqlite3.connect(str(DB), timeout=20)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS sessions (
        serial TEXT PRIMARY KEY, goal TEXT NOT NULL, check_seconds INTEGER NOT NULL,
        steps_per_cycle INTEGER NOT NULL, enabled INTEGER NOT NULL,
        last_status TEXT NOT NULL DEFAULT 'idle', updated_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, serial TEXT NOT NULL,
        created_at TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL
    )""")
    db.commit()
    return db

def now():
    return datetime.now(timezone.utc).isoformat()

def event(serial, kind, detail):
    with connect() as db:
        db.execute("INSERT INTO events(serial,created_at,kind,detail) VALUES(?,?,?,?)",
                   (serial, now(), kind, json.dumps(detail, ensure_ascii=False)[:12000]))
        # Keep a bounded log to avoid filling the disk.
        db.execute("DELETE FROM events WHERE id IN (SELECT id FROM events WHERE serial=? ORDER BY id DESC LIMIT -1 OFFSET 2000)", (serial,))

def update(serial, status, enabled=None):
    with connect() as db:
        if enabled is None:
            db.execute("UPDATE sessions SET last_status=?,updated_at=? WHERE serial=?", (status,now(),serial))
        else:
            db.execute("UPDATE sessions SET last_status=?,enabled=?,updated_at=? WHERE serial=?", (status,int(enabled),now(),serial))

def session(serial):
    with connect() as db:
        row = db.execute("SELECT serial,goal,check_seconds,steps_per_cycle,enabled,last_status,updated_at FROM sessions WHERE serial=?", (serial,)).fetchone()
    if row is None:
        return None
    return dict(zip(("serial","goal","check_seconds","steps_per_cycle","enabled","status","updated_at"), row))

def loop(serial, stop):
    last_digest = None
    error_count = 0
    event(serial, "started", {})
    try:
        while not stop.is_set():
            config = session(serial)
            if not config or not config["enabled"]:
                break
            try:
                if not connected(serial):
                    update(serial, "waiting_for_device")
                    if stop.wait(30):
                        break
                    continue
                png, _, _ = screenshot(serial)
                digest = hashlib.sha256(png).hexdigest()
                if digest != last_digest:
                    last_digest = digest
                    update(serial, "observing")
                    event(serial, "screen_changed", {"digest": digest[:16]})
                    # Bound each AI cycle, not total runtime. Stop can interrupt a cycle.
                    result = run_task(Task(task=config["goal"], serial=serial, max_steps=config["steps_per_cycle"]))
                    status = result.get("status", "unknown")
                    summary = {"status": status, "steps": result.get("steps", [])[-5:]}
                    event(serial, "cycle", summary)
                    update(serial, status)
                else:
                    update(serial, "idle_watching")
                error_count = 0
                if stop.wait(config["check_seconds"]):
                    break
            except HTTPException as exc:
                error_count += 1
                event(serial, "error", {"status": exc.status_code, "detail": str(exc.detail)[:400]})
                update(serial, "error_retrying")
                if stop.wait(min(300, 15 * 2 ** min(error_count, 4))):
                    break
            except Exception as exc:
                error_count += 1
                event(serial, "error", {"detail": str(exc)[:400]})
                update(serial, "error_retrying")
                if stop.wait(min(300, 15 * 2 ** min(error_count, 4))):
                    break
    finally:
        update(serial, "stopped", False)
        event(serial, "stopped", {})
        with _lock:
            _workers.pop(serial, None)
            _stops.pop(serial, None)

def launch(serial):
    with _lock:
        if serial in _workers and _workers[serial].is_alive():
            return False
        stop = threading.Event()
        worker = threading.Thread(target=loop, args=(serial,stop), daemon=True, name="agent-" + serial[:32])
        _stops[serial] = stop
        _workers[serial] = worker
        worker.start()
        return True

@app.post("/autonomy/start")
def start(request: StartRequest):
    if request.allow_send_messages:
        raise HTTPException(400, "Unattended outbound messaging requires a separate trusted-contact policy; not enabled.")
    if not connected(request.serial):
        raise HTTPException(404, "Device is not connected and authorized")
    with connect() as db:
        db.execute("""INSERT INTO sessions(serial,goal,check_seconds,steps_per_cycle,enabled,last_status,updated_at)
        VALUES(?,?,?,?,1,'starting',?)
        ON CONFLICT(serial) DO UPDATE SET goal=excluded.goal,check_seconds=excluded.check_seconds,
        steps_per_cycle=excluded.steps_per_cycle,enabled=1,last_status='starting',updated_at=excluded.updated_at""",
        (request.serial,request.goal,request.check_seconds,request.steps_per_cycle,now()))
    launched = launch(request.serial)
    return {"status": "started" if launched else "already_running", "serial": request.serial}

@app.post("/autonomy/stop")
def stop(request: SerialRequest):
    with _lock:
        stopper = _stops.get(request.serial)
        if stopper:
            stopper.set()
    with _guard:
        active = _cancel.get(request.serial)
        if active:
            active.set()
    update(request.serial, "stopping", False)
    return {"status": "stop_requested", "serial": request.serial}

@app.get("/autonomy/status")
def status(serial: str):
    result = session(serial)
    if result is None:
        return {"serial": serial, "enabled": False, "status": "not_configured"}
    with _lock:
        result["worker_alive"] = bool(_workers.get(serial) and _workers[serial].is_alive())
    return result

@app.get("/autonomy/history")
def history(serial: str, limit: int = 40):
    with connect() as db:
        rows = db.execute("SELECT id,created_at,kind,detail FROM events WHERE serial=? ORDER BY id DESC LIMIT ?",
                          (serial,max(1,min(limit,200)))).fetchall()
    return {"events": [{"id":r[0],"at":r[1],"kind":r[2],"detail":json.loads(r[3])} for r in rows]}

@app.on_event("startup")
def restore():
    with connect() as db:
        rows = db.execute("SELECT serial FROM sessions WHERE enabled=1").fetchall()
    for (serial,) in rows:
        launch(serial)

@app.on_event("shutdown")
def shutdown():
    with _lock:
        for stopper in _stops.values():
            stopper.set()
    with _guard:
        for active in _cancel.values():
            active.set()
