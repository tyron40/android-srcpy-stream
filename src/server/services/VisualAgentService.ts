import { spawn, ChildProcess } from 'child_process';
import { Socket } from 'net';
import path from 'path';
import fs from 'fs';

const PORT = 8003;

/** Start the local visual agent with the dashboard, without exposing the API key to the browser. */
export class VisualAgentService {
    private static process?: ChildProcess;
    private static owned = false;

    private static portOccupied(): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new Socket();
            let settled = false;
            const finish = (occupied: boolean): void => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(occupied);
            };
            socket.setTimeout(500);
            socket.once('connect', () => finish(true));
            socket.once('timeout', () => finish(false));
            socket.once('error', () => finish(false));
            socket.connect(PORT, '127.0.0.1');
        });
    }

    public static async start(): Promise<void> {
        if (process.env.ANDROID_AI_AUTOSTART === '0') return;
        if (this.process) return;
        if (await this.portOccupied()) {
            console.log('[VisualAgent] Port 8003 already in use; keeping existing service.');
            return;
        }
        // Bundled agent lives within the same Git repository, alongside dist.
        const directory = process.env.ANDROID_AI_DIR || path.resolve(__dirname, '..', 'android-agent');
        const script = path.join(directory, 'visual_agent.py');
        const python = process.env.ANDROID_AI_PYTHON ||
            path.join(directory, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
        if (!fs.existsSync(script) || !fs.existsSync(python)) {
            console.warn('[VisualAgent] Python agent not installed at ' + directory + '; AI chat will be unavailable.');
            return;
        }
        try {
            const child = spawn(python, ['-m', 'uvicorn', 'visual_agent:app', '--host', '127.0.0.1', '--port', String(PORT)], {
                cwd: directory,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                env: process.env,
            });
            this.process = child;
            this.owned = true;
            child.stdout?.on('data', (data: Buffer) => console.log('[VisualAgent] ' + data.toString().trim()));
            child.stderr?.on('data', (data: Buffer) => console.error('[VisualAgent] ' + data.toString().trim()));
            child.on('error', (error) => console.error('[VisualAgent] Failed to launch: ' + error.message));
            child.on('exit', (code) => {
                console.log('[VisualAgent] Exited with code ' + code);
                if (this.process === child) { this.process = undefined; this.owned = false; }
            });
            console.log('[VisualAgent] Starting Python service on localhost:8003');
        } catch (error) {
            console.error('[VisualAgent] ' + String(error));
        }
    }

    public static stop(): void {
        if (this.owned && this.process) this.process.kill();
        this.process = undefined;
        this.owned = false;
    }
}
