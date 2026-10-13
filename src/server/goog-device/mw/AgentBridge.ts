import WS from 'ws';
import { Mw, RequestParameters } from '../../mw/Mw';
import { Multiplexer } from '../../../packages/multiplexer/Multiplexer';
import { AgentActionExecutor } from '../AgentActionExecutor';
import {
    AgentBridgeClientMessage,
    AgentBridgeServerMessage,
    AgentTaskRunRequest,
    AgentTaskRunResult,
    AgentTaskStepResult,
} from '../../../types/AgentAction';
import { ControlCenter } from '../services/ControlCenter';
import { ChannelCode } from '../../../common/ChannelCode';
import { Config } from '../../Config';
import { AutoGlmClient } from '../../integrations/autoglm/AutoGlmClient';

const EVENT_TYPE_AGENT = 'agent';
const config = Config.getInstance();
const autoGlmClient = new AutoGlmClient(config.autoGlmBaseUrl, config.autoGlmTimeoutMs);

export class AgentBridge extends Mw {
    private stopped = false;
    private running = false;
    public static readonly TAG = 'AgentBridge';

    public static processChannel(ws: Multiplexer, code: string): Mw | undefined {
        if (code !== ChannelCode.ADBG) {
            return;
        }
        return new AgentBridge(ws);
    }

    public static processRequest(ws: WS, params: RequestParameters): Mw | undefined {
        if (params.action !== EVENT_TYPE_AGENT) {
            return;
        }
        return new AgentBridge(ws);
    }

    protected onSocketMessage(event: WS.MessageEvent): void {
        let payload: AgentBridgeClientMessage;
        try {
            payload = JSON.parse(event.data.toString()) as AgentBridgeClientMessage;
        } catch (error: unknown) {
            this.sendAgentMessage({
                type: 'task-error',
                data: {
                    error: error instanceof Error ? error.message : 'Invalid JSON payload',
                },
            });
            return;
        }

        if (payload.type === 'run-task') {
            this.runTask(payload.data).catch((error: unknown) => {
                this.sendAgentMessage({
                    type: 'task-error',
                    data: {
                        error: error instanceof Error ? error.message : String(error),
                    },
                });
            });
            return;
        }

        if (payload.type === 'stop') {
            this.stopped = true;
        }
    }

    private sendAgentMessage(message: AgentBridgeServerMessage): void {
        this.sendMessage({
            id: -1,
            type: EVENT_TYPE_AGENT,
            data: message,
        });
    }

    private validateRequest(data: AgentTaskRunRequest): string | null {
        if (!data || !Array.isArray(data.targets) || data.targets.length === 0) {
            return 'At least one target is required';
        }
        if (!data.task || !Array.isArray(data.task.steps) || data.task.steps.length === 0) {
            return 'Task must contain at least one step';
        }
        return null;
    }

    private async runTask(request: AgentTaskRunRequest): Promise<void> {
        const validationError = this.validateRequest(request);
        if (validationError) {
            this.sendAgentMessage({
                type: 'task-error',
                data: {
                    error: validationError,
                },
            });
            return;
        }

        if (this.running) {
            this.sendAgentMessage({ type: 'task-error', data: { error: 'A task is already running on this connection' } });
            return;
        }
        const connected = new Set(ControlCenter.getInstance().getDevices().filter((device) => device.state === 'device').map((device) => device.udid));
        const targets = Array.from(new Set(request.targets));
        const missing = targets.filter((target) => !connected.has(target));
        if (missing.length) {
            this.sendAgentMessage({ type: 'task-error', data: { error: `Devices not connected or authorized: ${missing.join(', ')}` } });
            return;
        }
        this.running = true;
        this.stopped = false;
        const startedAt = Date.now();
        this.sendAgentMessage({
            type: 'task-started',
            data: {
                request,
                startedAt,
            },
        });

        try {
        if (config.autoGlmEnabled) {
            try {
                const instruction = request.task.steps.map((step) => step.label || step.type).join(' -> ');
                const aiResults = await Promise.all(targets.map(async (target) => {
                    if (this.stopped) return false;
                    const response = await autoGlmClient.runTask({ device: target, instruction, extras: { request } });
                    return response.ok;
                }));

                const finishedAt = Date.now();
                const runResult: AgentTaskRunResult = {
                    ok: aiResults.every(Boolean) && !this.stopped,
                    request,
                    results: [],
                    startedAt,
                    finishedAt,
                };

                this.sendAgentMessage({
                    type: 'task-finished',
                    data: runResult,
                });
                return;
            } catch (error: unknown) {
                this.sendAgentMessage({
                    type: 'task-error',
                    data: {
                        error: `OpenAutoGLM failure: ${error instanceof Error ? error.message : String(error)}`,
                    },
                });
                return;
            }
        }

        const results: AgentTaskStepResult[] = [];
        await Promise.all(targets.map(async (target) => {
            for (let i = 0; i < request.task.steps.length && !this.stopped; i += 1) {
                const step = request.task.steps[i];
                const result = await AgentActionExecutor.runAction(target, step, i);
                results.push(result);
                this.sendAgentMessage({ type: 'task-step', data: result });
                if (!result.ok) break;
            }
        }));

        const finishedAt = Date.now();
        const runResult: AgentTaskRunResult = {
            ok: !this.stopped && results.length === targets.length * request.task.steps.length && results.every((item) => item.ok),
            request,
            results,
            startedAt,
            finishedAt,
        };

        this.sendAgentMessage({
            type: 'task-finished',
            data: runResult,
        });
        } finally {
            this.running = false;
        }
    }
}
