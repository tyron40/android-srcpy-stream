# Windows-only iPhone pointer backends

The project supports Android scrcpy separately. iPhone video and iPhone input must be negotiated independently.

## Input backend selection

1. **Built-in Bluetooth adapter:** Only offer this if a local Windows helper has *verified* BLE peripheral mode, GATT HID-over-GATT advertising, and a paired iPhone. Windows Bluetooth central support alone is insufficient. Do not claim ordinary Windows Bluetooth radios support this.
2. **External USB HID bridge:** A USB-attached microcontroller/adapter with firmware that acts as a Bluetooth HID mouse paired to the iPhone. The Windows helper sends authorized pointer movement and button commands to the adapter over a local serial interface. The USB cable attaches the bridge to the PC; the bridge communicates with the iPhone via Bluetooth.
3. **Existing WebDriverAgent:** Only when a signed, compatible WDA agent is available and its session is healthy.
4. **View-only fallback:** Always available when an iOS screen stream is available, even without input.

## Pairing and user interface

- For each iPhone, display separate **Video** and **Input** status.
- Input choices: `Auto`, `Windows BLE`, `External USB HID`, `WebDriverAgent`, `View only`.
- In Auto mode, prefer verified ready backends; never silently switch to an unpaired backend.
- On the iPhone enable Settings > Accessibility > Touch > AssistiveTouch > Devices and pair the advertised HID device.
- Explicitly confirm the iPhone being controlled and offer a prominent disconnect button.
- A device cannot be marked ready based solely on a connected COM port or Bluetooth radio.
- Never send commands while unpaired, disconnected, or view-only.

## Pointer protocol for the external bridge

A future Windows helper can use newline-delimited JSON over serial:

```json
{"type":"move","dx":10,"dy":-5}
{"type":"button","button":"left","down":true}
{"type":"button","button":"left","down":false}
{"type":"status"}
```

The adapter firmware must implement pairing, relative HID reports, button release on disconnect, and truthful ready status. This is a protocol proposal, **not** existing hardware support. The helper should validate and bound motion and only accept local authenticated control requests.

## Video transport

The existing iOS QVHack/MJPEG implementations need real-device verification; WDA MJPEG must not be treated as independent of WDA. Implement a Windows-compatible screen capture transport before claiming plug-and-play USB mirroring. A capture stream alone does not grant touch injection.

## Tests

Windows 10/11, supported iOS versions, initial Trust This Computer, AssistiveTouch pairing, adapter capability checks, USB reconnect, Bluetooth reconnect, portrait/landscape coordinate mapping, pointer calibration, taps, drag/swipe, multiple devices, and Android regression.

No Mac requirement applies to the *target experience*, not to all existing WDA tooling. Avoid promising no-Mac full control until a working hardware-backed path is verified.
