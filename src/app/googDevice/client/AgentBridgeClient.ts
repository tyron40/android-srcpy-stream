import { ChannelCode } from '../../../common/ChannelCode';
import { AgentBridgeClientMessage, AgentBridgeServerMessage, AgentTaskRunRequest } from '../../../types/AgentAction';

export type AgentBridgeListener = {
    onTaskStarted?: (message: AgentBridgeServerMessage) => void;
    onTaskStep?: (message: AgentBridgeServerMessage) => void;
    onTaskFinished?: (message: AgentBridgeServerMessage) => void;
    onTaskError?: (error: string) => void;
};

export class AgentBridgeClient {
    private ws: WebSocket;
    private listener?: AgentBridgeListener;

    public static create(wsBaseUrl: string, listener?: AgentBridgeListener): AgentBridgeClient {
        return new AgentBridgeClient(wsBaseUrl, listener);
    }

    private constructor(wsBaseUrl: string, listener?: AgentBridgeListener) {
        this.listener = listener;
        this.ws = this.createWebSocket(wsBaseUrl);
    }

    private createWebSocket(url: string): WebSocket {
        const ws = new WebSocket(url, ChannelCode.ADBG);
        ws.addEventListener('message', this.onSocketMessage);
        ws.addEventListener('error', this.onSocketError);
        ws.addEventListener('close', this.onSocketClose);
        return ws;
    }

    private onSocketMessage = async (event: MessageEvent): Promise<void> => {
        const url = this.ws.url;
        const dataType = Object.prototype.toString.call(event.data);

        let payloadText = '';

        try {
            if (typeof event.data === 'string') {
                payloadText = event.data;
            } else if (event.data instanceof Blob) {
                payloadText = await event.data.text();
            } else if (event.data instanceof ArrayBuffer) {
                payloadText = new TextDecoder().decode(event.data);
            } else {
                throw new Error(`Unsupported WebSocket data type: ${dataType}`);
            }

            const payload = JSON.parse(payloadText) as { type: string; data: AgentBridgeServerMessage };

            if (payload.type !== 'agent' || !payload.data) {
                return;
            }

            const data = payload.data;
            if (data.type === 'task-started') {
                this.listener?.onTaskStarted?.(data);
                return;
            }
            if (data.type === 'task-step') {
                this.listener?.onTaskStep?.(data);
                return;
            }
            if (data.type === 'task-finished') {
                this.listener?.onTaskFinished?.(data);
                return;
            }
            if (data.type === 'task-error') {
                this.listener?.onTaskError?.(data.data.error);
            }
        } catch (error: unknown) {
            this.listener?.onTaskError?.(
                `Failed to parse agent WebSocket message. ws=${url}, dataType=${dataType}, preview=${payloadText.slice(
                    0,
                    200,
                )}, error=${error instanceof Error ? error.message : String(error)}`,
            );
        }
    };

    private onSocketError = (): void => {
        this.listener?.onTaskError?.('Agent bridge socket error');
    };

    private onSocketClose = (): void => {
        this.listener?.onTaskError?.('Agent bridge socket closed');
    };

    public runTask(request: AgentTaskRunRequest): void {
        this.sendRaw({
            type: 'run-task',
            data: request,
        });
    }

    public stopTask(): void {
        this.sendRaw({
            type: 'stop',
        });
    }

    private sendRaw(payload: AgentBridgeClientMessage): void {
        if (this.ws.readyState !== WebSocket.OPEN) {
            this.listener?.onTaskError?.('Agent bridge socket is not open');
            return;
        }
        this.ws.send(JSON.stringify(payload));
    }

    public release(): void {
        this.ws.removeEventListener('message', this.onSocketMessage);
        this.ws.removeEventListener('error', this.onSocketError);
        this.ws.removeEventListener('close', this.onSocketClose);
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
        }
        this.listener = undefined;
    }
}
