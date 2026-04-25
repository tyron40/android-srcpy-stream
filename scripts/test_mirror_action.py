import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8000"
URL = f"{BASE_URL}/mirror-action"
DEVICES_URL = f"{BASE_URL}/devices"


def fetch_devices():
    req = urllib.request.Request(DEVICES_URL, method="GET")
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        data = json.loads(body)
        return data.get("devices", [])


devices = []
try:
    devices = fetch_devices()
    print(f"devices: {devices}")
except Exception as e:
    print(f"devices fetch failed: {e}")

master = devices[0] if len(devices) >= 1 else "master-1"
target = devices[1] if len(devices) >= 2 else "target-1"

tests = [
    (
        "happy_path",
        {
            "masterSerial": master,
            "targetSerials": [target],
            "action": {"type": "tap", "x": 100, "y": 200},
        },
    ),
    (
        "missing_masterSerial",
        {
            "targetSerials": [target],
            "action": {"type": "tap", "x": 100, "y": 200},
        },
    ),
    (
        "empty_targets",
        {
            "masterSerial": master,
            "targetSerials": [],
            "action": {"type": "tap", "x": 100, "y": 200},
        },
    ),
    (
        "missing_action",
        {
            "masterSerial": master,
            "targetSerials": [target],
        },
    ),
]

for name, payload in tests:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            print(f"{name}: HTTP {resp.status} | {body[:300]}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"{name}: HTTP {e.code} | {body[:300]}")
    except Exception as e:
        print(f"{name}: ERROR | {e}")
