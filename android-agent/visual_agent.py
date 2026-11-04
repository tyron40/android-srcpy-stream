"""Android visual agent, operated only on explicitly connected ADB devices."""
import base64
import json
import os
import re
import struct
import subprocess
import threading
import time
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI

load_dotenv()
app = FastAPI(title="Unified Android Visual Agent")
_locks: dict[str, threading.Lock] = {}
_cancel: dict[str, threading.Event] = {}
_guard = threading.Lock()

class Task(BaseModel):
    task: str = Field(min_length=1, max_length=2000)
    serial: str = Field(min_length=1, max_length=128)
    max_steps: int = Field(default=15, ge=1, le=25)

class Stop(BaseModel):
    serial: str = Field(min_length=1, max_length=128)

def adb(serial: str, *args: str, timeout: int = 25) -> bytes:
    result = subprocess.run(["adb", "-s", serial, *args], capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).decode("utf-8", "replace")[:400])
    return result.stdout

def connected(serial: str) -> bool:
    output = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=10, check=True).stdout
    return any(line.split() == [serial, "device"] for line in output.splitlines()[1:])

def screenshot(serial: str) -> tuple[bytes, int, int]:
    png = adb(serial, "exec-out", "screencap", "-p")
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("ADB returned invalid PNG data")
    width, height = struct.unpack(">II", png[16:24])
    if not (1 <= width <= 10000 and 1 <= height <= 10000):
        raise ValueError("Invalid Android screenshot dimensions")
    return png, width, height

def coord(n: Any, limit: int) -> int:
    # Coordinates requested as percentages of the screenshot.
    value = float(n)
    if not (0 <= value <= 100):
        raise ValueError("Coordinates must be between 0 and 100 percent")
    return max(0, min(limit - 1, round(value * (limit - 1) / 100)))

def act(serial: str, action: dict, width: int, height: int) -> str:
    kind = action.get("action")
    if kind == "done":
        return "done"
    if kind == "tap":
        adb(serial, "shell", "input", "tap", str(coord(action["x"], width)), str(coord(action["y"], height)))
    elif kind == "swipe":
        adb(serial, "shell", "input", "swipe", str(coord(action["x1"], width)), str(coord(action["y1"], height)),
            str(coord(action["x2"], width)), str(coord(action["y2"], height)), str(max(100, min(1500, int(action.get("duration_ms", 350))))))
    elif kind in ("home", "back"):
        adb(serial, "shell", "input", "keyevent", "3" if kind == "home" else "4")
    else:
        raise ValueError("Unsupported action: " + str(kind))
    return kind

@app.get("/health")
def health():
    return {"status": "healthy", "has_key": bool(os.getenv("OPENAI_API_KEY"))}

@app.post("/stop-task")
def stop_task(request: Stop):
    with _guard:
        cancel = _cancel.get(request.serial)
    if cancel is not None:
        cancel.set()
        return {"status": "stop_requested", "serial": request.serial}
    return {"status": "idle", "serial": request.serial}

@app.post("/run-task")
def run_task(request: Task):
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", request.serial):
        raise HTTPException(400, "Invalid device serial")
    if not connected(request.serial):
        raise HTTPException(404, "Selected device is not authorized and connected through ADB")
    with _guard:
        lock = _locks.setdefault(request.serial, threading.Lock())
    if not lock.acquire(blocking=False):
        raise HTTPException(409, "A task is already running on this device")
    cancel = threading.Event()
    with _guard:
        _cancel[request.serial] = cancel
    history: list[dict] = []
    try:
        if not os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY") == "PASTE_NEW_KEY_HERE":
            raise HTTPException(503, "Set OPENAI_API_KEY in android-agent/.env")
        client = OpenAI(timeout=60, max_retries=1)
        for step in range(request.max_steps):
            if cancel.is_set():
                return {"status": "stopped", "steps": history}
            png, width, height = screenshot(request.serial)
            context = json.dumps(history[-6:])
            instruction = (
                "Return ONLY one JSON object with an action. Supported actions are "
                "tap{x,y}, swipe{x1,y1,x2,y2,duration_ms}, back, home, done. "
                "Coordinates are percentages from 0 to 100, never pixels. "
                "Example JSON: {\"action\":\"tap\",\"x\":50,\"y\":40}. "
                "Never enter credentials, make purchases, send messages, delete data, or change security settings. "
                "For these requests or when a login or confirmation is needed, return "
                "{\"action\":\"done\",\"note\":\"Manual approval required\"}. "
                "Use done only after the requested target is visible, or when blocked. "
                "Task: " + request.task + ". Previous steps JSON: " + context
            )
            reply = client.responses.create(
                model=os.getenv("ANDROID_AI_MODEL", "gpt-4.1-mini"),
                input=[{"role": "user", "content": [
                    {"type": "input_text", "text": instruction},
                    {"type": "input_image", "image_url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")},
                ]}],
                text={"format": {"type": "json_object"}},
            )
            action = json.loads(reply.output_text)
            if not isinstance(action, dict):
                raise ValueError("Model did not return a JSON object")
            try:
                result = act(request.serial, action, width, height)
                history.append({"action": action, "result": result})
            except (ValueError, KeyError, TypeError) as exc:
                history.append({"action": action, "error": str(exc)})
                continue
            if result == "done":
                return {"status": "completed", "steps": history}
            time.sleep(1.2)
        return {"status": "max_steps_reached", "steps": history}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, type(exc).__name__ + ": " + str(exc)[:350]) from exc
    finally:
        with _guard:
            if _cancel.get(request.serial) is cancel:
                del _cancel[request.serial]
        lock.release()
