import { spawn } from 'child_process';
import { MirrorAction, MirrorActionRequest, MirrorActionResponse, MirrorTargetResult } from '../../../types/MirrorAction';

type ScreenSize = {
    width: number;
    height: number;
};

type ScreenCacheEntry = ScreenSize & {
    cachedAt: number;
};

const SCREEN_CACHE_TTL_MS = 10_000;

export class MirrorActionService {
    private static screenCache = new Map<string, ScreenCacheEntry>();

    public static async execute(request: MirrorActionRequest): Promise<MirrorActionResponse> {
        this.validateRequest(request);

        const { masterSerial, targetSerials, action } = request;
        const dedupedTargets = Array.from(new Set(targetSerials.filter((s) => s && s !== masterSerial)));

        const masterSize = await this.getScreenSize(masterSerial);
        const results: MirrorTargetResult[] = [];

        for (const serial of dedupedTargets) {
            try {
                const targetSize = await this.getScreenSize(serial);
                const scaledAction = this.scaleAction(action, masterSize, targetSize);
                const command = this.buildCommand(serial, scaledAction);
                await this.runAdb(command);
                results.push({
                    serial,
                    ok: true,
                    command: command.join(' '),
                    scaledAction,
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                const fallbackAction = this.safeCloneAction(action);
                const fallbackCommand = this.buildCommand(serial, fallbackAction);
                results.push({
                    serial,
                    ok: false,
                    command: fallbackCommand.join(' '),
                    scaledAction: fallbackAction,
                    error: message,
                });
            }
        }

        return {
            ok: results.length > 0 && results.every((r) => r.ok),
            masterSerial,
            actionType: action.type,
            results,
        };
    }

    private static validateRequest(request: MirrorActionRequest): void {
        if (!request || typeof request !== 'object') {
            throw new Error('Invalid body');
        }
        if (!request.masterSerial || typeof request.masterSerial !== 'string') {
            throw new Error('masterSerial is required');
        }
        if (!Array.isArray(request.targetSerials) || request.targetSerials.length === 0) {
            throw new Error('targetSerials must be a non-empty array');
        }
        if (!request.action || typeof request.action !== 'object' || typeof request.action.type !== 'string') {
            throw new Error('action is required');
        }

        const { action } = request;
        if (action.type === 'tap') {
            if (!this.isFiniteNumber(action.x) || !this.isFiniteNumber(action.y)) {
                throw new Error('tap action requires numeric x,y');
            }
            return;
        }

        if (action.type === 'swipe') {
            if (
                !this.isFiniteNumber(action.x1) ||
                !this.isFiniteNumber(action.y1) ||
                !this.isFiniteNumber(action.x2) ||
                !this.isFiniteNumber(action.y2)
            ) {
                throw new Error('swipe action requires numeric x1,y1,x2,y2');
            }
            if (typeof action.duration !== 'undefined' && !this.isFiniteNumber(action.duration)) {
                throw new Error('swipe duration must be numeric');
            }
            return;
        }

        if (action.type === 'key') {
            if (!this.isFiniteNumber(action.keyCode)) {
                throw new Error('key action requires numeric keyCode');
            }
            return;
        }

        if (action.type === 'text') {
            if (typeof action.text !== 'string') {
                throw new Error('text action requires text');
            }
            return;
        }

        throw new Error(`Unsupported action type: ${(action as MirrorAction).type}`);
    }

    private static isFiniteNumber(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value);
    }

    private static safeCloneAction(action: MirrorAction): MirrorAction {
        return JSON.parse(JSON.stringify(action)) as MirrorAction;
    }

    private static scaleAction(action: MirrorAction, masterSize: ScreenSize, targetSize: ScreenSize): MirrorAction {
        if (action.type === 'tap') {
            return {
                type: 'tap',
                x: this.scale(action.x, masterSize.width, targetSize.width),
                y: this.scale(action.y, masterSize.height, targetSize.height),
            };
        }

        if (action.type === 'swipe') {
            return {
                type: 'swipe',
                x1: this.scale(action.x1, masterSize.width, targetSize.width),
                y1: this.scale(action.y1, masterSize.height, targetSize.height),
                x2: this.scale(action.x2, masterSize.width, targetSize.width),
                y2: this.scale(action.y2, masterSize.height, targetSize.height),
                duration: action.duration,
            };
        }

        return this.safeCloneAction(action);
    }

    private static scale(value: number, from: number, to: number): number {
        if (!from || from <= 0) {
            return Math.round(value);
        }
        return Math.round((value * to) / from);
    }

    private static buildCommand(serial: string, action: MirrorAction): string[] {
        if (action.type === 'tap') {
            return ['-s', serial, 'shell', 'input', 'tap', `${action.x}`, `${action.y}`];
        }
        if (action.type === 'swipe') {
            const duration = Number.isFinite(action.duration) ? `${Math.round(action.duration as number)}` : '300';
            return [
                '-s',
                serial,
                'shell',
                'input',
                'swipe',
                `${action.x1}`,
                `${action.y1}`,
                `${action.x2}`,
                `${action.y2}`,
                duration,
            ];
        }
        if (action.type === 'key') {
            return ['-s', serial, 'shell', 'input', 'keyevent', `${Math.round(action.keyCode)}`];
        }
        const escaped = this.escapeText(action.text);
        return ['-s', serial, 'shell', 'input', 'text', escaped];
    }

    private static escapeText(text: string): string {
        if (!text) {
            return '""';
        }
        return text
            .replace(/ /g, '%s')
            .replace(/"/g, '\\"')
            .replace(/'/g, "\\'")
            .replace(/&/g, '\\&')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    private static async getScreenSize(serial: string): Promise<ScreenSize> {
        const cached = this.screenCache.get(serial);
        const now = Date.now();
        if (cached && now - cached.cachedAt < SCREEN_CACHE_TTL_MS) {
            return { width: cached.width, height: cached.height };
        }

        const output = await this.runAdb(['-s', serial, 'shell', 'wm', 'size']);
        const parsed = this.parseWmSize(output);
        this.screenCache.set(serial, { ...parsed, cachedAt: now });
        return parsed;
    }

    private static parseWmSize(output: string): ScreenSize {
        const match = output.match(/Physical size:\s*(\d+)x(\d+)/i) || output.match(/(\d+)x(\d+)/);
        if (!match) {
            throw new Error(`Unable to parse wm size: ${output}`);
        }
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new Error(`Invalid wm size: ${output}`);
        }
        return { width, height };
    }

    private static runAdb(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn('adb', args, { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk: Buffer | string) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk: Buffer | string) => {
                stderr += chunk.toString();
            });

            child.on('error', (error) => {
                reject(error);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                    return;
                }
                reject(new Error(`adb ${args.join(' ')} failed with code ${code}: ${stderr || stdout}`));
            });
        });
    }
}
