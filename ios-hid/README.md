# iPhone AssistiveTouch hardware bridge (experimental)

This is a **local, opt-in** prototype for controlling an iPhone with a physical mouse interface. It is not iOS remote-control software, and it does not mirror the screen.

## Requirements
- A compatible USB HID-capable CircuitPython board with a separate USB data connection to the iPhone and a serial connection to Windows (hardware configuration varies; not all boards support simultaneous links).
- iPhone with AssistiveTouch enabled: Settings > Accessibility > Touch > AssistiveTouch.
- Windows Python 3 and `pyserial` (`python -m pip install pyserial`).
- A device-side firmware implementation that receives the newline-delimited JSON protocol and emits **real HID mouse events**. Firmware is **not included**: it depends on the exact board, USB topology, and HID library.

## Protocol
One JSON object per line:
- `{"type":"move","dx":10,"dy":-5}`
- `{"type":"click"}`
- `{"type":"scroll","dy":-2}`
- `{"type":"stop"}`

## Try locally
`python ios-hid/bridge.py --port COM5 --dry-run` to validate commands without hardware.
Then, only after installing compatible firmware and connecting hardware, remove `--dry-run`.

## Limits
AssistiveTouch does **not** expose a network or USB API to inject touches. This bridge is **not connected to the Render site or the Windows dashboard**. The iPhone must explicitly pair/accept its input accessory. Screen capture requires a separate, user-approved solution. Full system-level iOS automation and synchronized taps cannot be promised.
