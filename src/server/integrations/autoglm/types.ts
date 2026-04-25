export type ParsedResponse =
    | {
          kind: 'json';
          value: unknown;
      }
    | {
          kind: 'binary';
          value: ArrayBuffer;
      }
    | {
          kind: 'text';
          value: string;
      };

export interface AutoGlmRunTaskRequest {
    device: string;
    instruction: string;
    extras?: Record<string, unknown>;
}

export interface AutoGlmRunTaskResponse {
    ok: boolean;
    taskId?: string;
    status?: string;
    raw?: unknown;
}

export interface AutoGlmStopTaskRequest {
    device: string;
    taskId?: string;
}
