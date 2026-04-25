import { AutoGlmRunTaskRequest, AutoGlmRunTaskResponse, AutoGlmStopTaskRequest, ParsedResponse } from './types';

type AnyRecord = Record<string, unknown>;

export class AutoGlmClient {
    constructor(private readonly baseUrl: string, private readonly timeoutMs: number) {}

    public async runTask(request: AutoGlmRunTaskRequest): Promise<AutoGlmRunTaskResponse> {
        const candidates = [
            '/run-task',
            '/task/run',
            '/api/run-task',
            '/api/task/run',
            '/v1/run-task',
            '/v1/task/run',
        ];

        let lastError = '';
        for (const path of candidates) {
            try {
                const response = await this.request(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request),
                });

                if (response.kind === 'json') {
                    const payload = response.value as AnyRecord;
                    const okValue = payload.ok;
                    const statusValue = payload.status;
                    const ok =
                        typeof okValue === 'boolean'
                            ? okValue
                            : typeof statusValue === 'string'
                            ? statusValue.toLowerCase() !== 'error'
                            : true;

                    return {
                        ok,
                        status: typeof statusValue === 'string' ? statusValue : `ok:${path}`,
                        raw: payload,
                    };
                }

                if (response.kind === 'text') {
                    return {
                        ok: true,
                        status: response.value,
                        raw: response.value,
                    };
                }

                return {
                    ok: true,
                    status: `binary-response:${path}`,
                    raw: response.value,
                };
            } catch (error: unknown) {
                lastError = error instanceof Error ? error.message : String(error);
            }
        }

        throw new Error(`OpenAutoGLM runTask failed for all endpoints. Last error: ${lastError}`);
    }

    public async stopTask(request: AutoGlmStopTaskRequest): Promise<ParsedResponse> {
        const candidates = ['/stop-task', '/task/stop', '/api/stop-task', '/api/task/stop', '/v1/stop-task', '/v1/task/stop'];

        let lastError = '';
        for (const path of candidates) {
            try {
                return await this.request(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request),
                });
            } catch (error: unknown) {
                lastError = error instanceof Error ? error.message : String(error);
            }
        }

        throw new Error(`OpenAutoGLM stopTask failed for all endpoints. Last error: ${lastError}`);
    }

    private async request(path: string, init: RequestInit): Promise<ParsedResponse> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
            });

            const contentType = response.headers.get('content-type') || '';
            console.log(`[AutoGlmClient] ${url} -> ${response.status} ${contentType}`);

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 400)}`);
            }

            if (contentType.includes('application/json')) {
                return {
                    kind: 'json',
                    value: await response.json(),
                };
            }

            if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
                return {
                    kind: 'binary',
                    value: await response.arrayBuffer(),
                };
            }

            return {
                kind: 'text',
                value: await response.text(),
            };
        } finally {
            clearTimeout(timeout);
        }
    }
}
