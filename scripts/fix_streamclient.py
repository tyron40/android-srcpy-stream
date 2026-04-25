from pathlib import Path

p = Path("src/app/googDevice/client/StreamClientScrcpy.ts")
s = p.read_text(encoding="utf-8", errors="replace")

s = s.replace("import { MirrorAction } from '../../../types/MirrorAction';\n", "")
s = s.replace("        this.syncManager.fanout(message);\n", "")
s = s.replace(
    "    }\\n    private static isChatFocusMode(): boolean {",
    "    }\n\n    private static isChatFocusMode(): boolean {",
)

p.write_text(s, encoding="utf-8")

t = p.read_text(encoding="utf-8", errors="replace")
print("MirrorAction" in t, "fanout(" in t, "}\\n    private static isChatFocusMode" in t)
