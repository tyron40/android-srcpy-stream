export type AgentActionType = 'tap' | 'swipe' | 'text' | 'key' | 'wait' | 'shell';

export type AgentActionBase = {
    type: AgentActionType;
    label?: string;
};

export type AgentActionTap = AgentActionBase & {
    type: 'tap';
    x: number;
    y: number;
};

export type AgentActionSwipe = AgentActionBase & {
    type: 'swipe';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    durationMs?: number;
};

export type AgentActionText = AgentActionBase & {
    type: 'text';
    value: string;
};

export type AgentActionKey = AgentActionBase & {
    type: 'key';
    keyCode: number | string;
};

export type AgentActionWait = AgentActionBase & {
    type: 'wait';
    ms: number;
};

export type AgentActionShell = AgentActionBase & {
    type: 'shell';
    command: string;
};

export type AgentAction =
    | AgentActionTap
    | AgentActionSwipe
    | AgentActionText
    | AgentActionKey
    | AgentActionWait
    | AgentActionShell;

export type AgentTask = {
    name?: string;
    steps: AgentAction[];
};

export type AgentTaskRunRequest = {
    masterUdid?: string;
    targets: string[];
    task: AgentTask;
    repeat?: {
        durationMinutes: number;
        intervalMs?: number;
    };
};

export type AgentTaskStepResult = {
    target: string;
    stepIndex: number;
    ok: boolean;
    type: AgentActionType;
    label?: string;
    error?: string;
    startedAt: number;
    finishedAt: number;
};

export type AgentTaskRunResult = {
    ok: boolean;
    request: AgentTaskRunRequest;
    results: AgentTaskStepResult[];
    startedAt: number;
    finishedAt: number;
};

export type AgentBridgeClientMessage =
    | {
          type: 'run-task';
          data: AgentTaskRunRequest;
      }
    | {
          type: 'stop';
      };

export type AgentBridgeServerMessage =
    | {
          type: 'task-started';
          data: {
              request: AgentTaskRunRequest;
              startedAt: number;
          };
      }
    | {
          type: 'task-step';
          data: AgentTaskStepResult;
      }
    | {
          type: 'task-finished';
          data: AgentTaskRunResult;
      }
    | {
          type: 'task-error';
          data: {
              error: string;
          };
      };
