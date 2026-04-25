export type MirrorActionTap = {
    type: 'tap';
    x: number;
    y: number;
};

export type MirrorActionSwipe = {
    type: 'swipe';
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    duration?: number;
};

export type MirrorActionText = {
    type: 'text';
    text: string;
};

export type MirrorActionKey = {
    type: 'key';
    keyCode: number;
};

export type MirrorAction = MirrorActionTap | MirrorActionSwipe | MirrorActionText | MirrorActionKey;

export type MirrorActionRequest = {
    masterSerial: string;
    targetSerials: string[];
    action: MirrorAction;
};

export type MirrorTargetResult = {
    serial: string;
    ok: boolean;
    command: string;
    scaledAction: MirrorAction;
    error?: string;
};

export type MirrorActionResponse = {
    ok: boolean;
    masterSerial: string;
    actionType: MirrorAction['type'];
    results: MirrorTargetResult[];
};
