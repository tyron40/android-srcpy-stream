import { AdbExtended } from './adb';
import { AgentAction, AgentTaskStepResult } from '../../types/AgentAction';

export class AgentActionExecutor {
    public static readonly TAG = 'AgentActionExecutor';

    private static escapeShellArg(value: string): string {
        return value.replace(/(["\\$`])/g, '\\$1').replace(/\s/g, '%s');
    }

    private static async runShell(udid: string, command: string): Promise<void> {
        const client = AdbExtended.createClient();
        const stream = await client.shell(udid, command);
        await AdbExtended.util.readAll(stream);
    }

    public static async runAction(udid: string, action: AgentAction, stepIndex: number): Promise<AgentTaskStepResult> {
        const startedAt = Date.now();
        try {
            switch (action.type) {
                case 'tap': {
                    await this.runShell(udid, `input tap ${action.x} ${action.y}`);
                    break;
                }
                case 'swipe': {
                    const duration = action.durationMs ? ` ${Math.max(0, action.durationMs)}` : '';
                    await this.runShell(
                        udid,
                        `input swipe ${action.x1} ${action.y1} ${action.x2} ${action.y2}${duration}`,
                    );
                    break;
                }
                case 'text': {
                    const escaped = this.escapeShellArg(action.value);
                    await this.runShell(udid, `input text "${escaped}"`);
                    break;
                }
                case 'key': {
                    await this.runShell(udid, `input keyevent ${action.keyCode}`);
                    break;
                }
                case 'wait': {
                    await new Promise((resolve) => setTimeout(resolve, Math.max(0, action.ms)));
                    break;
                }
                case 'shell': {
                    await this.runShell(udid, action.command);
                    break;
                }
                default: {
                    throw new Error(`Unsupported action type ${(action as { type?: string }).type || 'unknown'}`);
                }
            }
            return {
                target: udid,
                stepIndex,
                ok: true,
                type: action.type,
                label: action.label,
                startedAt,
                finishedAt: Date.now(),
            };
        } catch (error: unknown) {
            return {
                target: udid,
                stepIndex,
                ok: false,
                type: action.type,
                label: action.label,
                error: error instanceof Error ? error.message : String(error),
                startedAt,
                finishedAt: Date.now(),
            };
        }
    }
}
