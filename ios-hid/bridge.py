"""Explicitly enabled iPhone mouse bridge for a USB HID-capable microcontroller.
Requires a board running the companion CircuitPython firmware. Does not bypass iOS permissions.
"""
import argparse
import json
import sys
import time

def main():
    p = argparse.ArgumentParser(description="iPhone AssistiveTouch HID bridge")
    p.add_argument("--port", required=True, help="Serial port of a compatible HID bridge (e.g. COM5)")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--dry-run", action="store_true", help="Print actions without sending them")
    args = p.parse_args()
    if not args.dry_run:
        try:
            import serial
        except ImportError:
            sys.exit("Install pyserial first: python -m pip install pyserial")
        conn = serial.Serial(args.port, args.baud, timeout=2)
        time.sleep(2)
    else:
        conn = None
    print("Bridge ready. Enter one JSON action per line: move(dx,dy), click, scroll(dy), or stop.", flush=True)
    try:
        for line in sys.stdin:
            try:
                action = json.loads(line)
                kind = action.get("type")
                if kind not in ("move", "click", "scroll", "stop"):
                    raise ValueError("Unsupported action")
                if kind in ("move", "scroll"):
                    for k in (("dx", "dy") if kind == "move" else ("dy",)):
                        if type(action.get(k)) is not int or abs(action[k]) > 100:
                            raise ValueError("Movement must be integer between -100 and 100")
                payload = json.dumps(action, separators=(",", ":"))
                if conn:
                    conn.write((payload + "\n").encode("ascii"))
                    conn.flush()
                print(json.dumps({"ok": True, "action": action}), flush=True)
                if kind == "stop":
                    break
            except (ValueError, TypeError, json.JSONDecodeError) as e:
                print(json.dumps({"ok": False, "error": str(e)}), flush=True)
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()
