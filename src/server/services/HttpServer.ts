import { VisualAgentService } from './VisualAgentService';
import * as http from 'http';
import * as https from 'https';
import path from 'path';
import { Service } from './Service';
import { Utils } from '../Utils';
import express, { Express } from 'express';
import { Config } from '../Config';
import { TypedEmitter } from '../../common/TypedEmitter';
import * as process from 'process';
import { EnvName } from '../EnvName';
import { MirrorActionService } from '../goog-device/services/MirrorActionService';
import { MirrorActionRequest } from '../../types/MirrorAction';
import { ControlCenter as GoogControlCenter } from '../goog-device/services/ControlCenter';

const DEFAULT_STATIC_DIR = path.join(__dirname, './public');

const PATHNAME = process.env[EnvName.WS_SCRCPY_PATHNAME] || __PATHNAME__;

export type ServerAndPort = {
    server: https.Server | http.Server;
    port: number;
};

interface HttpServerEvents {
    started: boolean;
}

export class HttpServer extends TypedEmitter<HttpServerEvents> implements Service {
    private static instance: HttpServer;
    private static PUBLIC_DIR = DEFAULT_STATIC_DIR;
    private static SERVE_STATIC = true;
    private servers: ServerAndPort[] = [];
    private mainApp?: Express;
    private started = false;

    protected constructor() {
        super();
    }

    public static getInstance(): HttpServer {
        if (!this.instance) {
            this.instance = new HttpServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public static setPublicDir(dir: string): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.PUBLIC_DIR = dir;
    }

    public static setServeStatic(enabled: boolean): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.SERVE_STATIC = enabled;
    }

    public async getServers(): Promise<ServerAndPort[]> {
        if (this.started) {
            return [...this.servers];
        }
        return new Promise<ServerAndPort[]>((resolve) => {
            this.once('started', () => {
                resolve([...this.servers]);
            });
        });
    }

    public getName(): string {
        return `HTTP(s) Server Service`;
    }

    public async start(): Promise<void> {
        await VisualAgentService.start();
        this.mainApp = express();
        this.mainApp.use(express.json({ limit: '1mb' }));

        this.mainApp.post('/mirror-action', async (req, res) => {
            try {
                const payload = req.body as MirrorActionRequest;
                const result = await MirrorActionService.execute(payload);
                res.status(200).json(result);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                res.status(400).json({
                    ok: false,
                    error: message,
                });
            }
        });

        this.mainApp.get('/devices', async (_req, res) => {
            try {
                const controlCenter = GoogControlCenter.getInstance();
                await controlCenter.init();
                const devices = controlCenter
                    .getDevices()
                    .filter((d) => d.state === 'device')
                    .map((d) => d.udid);
                res.status(200).json({ devices });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                res.status(500).json({
                    ok: false,
                    error: message,
                });
            }
        });

        // Forward AI tasks to the locally running Python agent. Never expose its key to browsers.
        // Restrict access to same-origin requests; disable this endpoint on public hosts
        // unless your deployment has authentication and CSRF protection.
        const agentUrl = process.env.ANDROID_VISUAL_AGENT_URL || 'http://127.0.0.1:8003';
        const agentRequest = async (req: express.Request, res: express.Response, target: '/run-task' | '/stop-task'): Promise<void> => {
            const source = req.get('origin');
            if (source && source !== `${req.protocol}://${req.get('host')}`) {
                res.status(403).json({ error: 'Cross-origin AI commands are forbidden' });
                return;
            }
            if (!req.get('origin') && req.get('sec-fetch-site') === 'cross-site') {
                res.status(403).json({ error: 'Cross-site AI commands are forbidden' });
                return;
            }
            const serial = req.body && req.body.serial;
            if (typeof serial !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(serial)) {
                res.status(400).json({ error: 'Valid device serial required' });
                return;
            }
            const controlCenter = GoogControlCenter.getInstance();
            await controlCenter.init();
            if (!controlCenter.getDevices().some((d) => d.state === 'device' && d.udid === serial)) {
                res.status(404).json({ error: 'Device not connected' });
                return;
            }
            if (target === '/run-task' && (typeof req.body.task !== 'string' || !req.body.task.trim() || req.body.task.length > 2000)) {
                res.status(400).json({ error: 'Task must be 1–2000 characters' });
                return;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 310000);
            try {
                const upstream = await fetch(agentUrl + target, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(target === '/run-task' ? {
                        task: req.body.task,
                        serial,
                        max_steps: Math.max(1, Math.min(25, Number(req.body.max_steps) || 15)),
                    } : { serial }),
                    signal: controller.signal,
                });
                const body = await upstream.text();
                res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(body);
            } catch (error: unknown) {
                res.status(502).json({ error: 'Android visual agent unavailable: ' + (error instanceof Error ? error.message : String(error)) });
            } finally {
                clearTimeout(timer);
            }
        };
        this.mainApp.post('/ai-agent/run', (req, res) => { void agentRequest(req, res, '/run-task').catch((e) => res.status(500).json({ error: String(e) })); });
        this.mainApp.post('/ai-agent/stop', (req, res) => { void agentRequest(req, res, '/stop-task').catch((e) => res.status(500).json({ error: String(e) })); });


        // Persistent autonomous sessions: start, stop, status and history.
        const autonomyProxy = async (req: express.Request, res: express.Response, endpoint: string, method: 'GET' | 'POST'): Promise<void> => {
            const origin = req.get('origin');
            if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
                res.status(403).json({ error: 'Cross-origin command rejected' });
                return;
            }
            if (req.get('sec-fetch-site') === 'cross-site') {
                res.status(403).json({ error: 'Cross-site command rejected' });
                return;
            }
            const serial = method === 'GET' ? req.query.serial : req.body && req.body.serial;
            if (typeof serial !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(serial)) {
                res.status(400).json({ error: 'Invalid device serial' });
                return;
            }
            const upstreamUrl = new URL(agentUrl + endpoint);
            if (method === 'GET') upstreamUrl.searchParams.set('serial', serial);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const upstream = await fetch(upstreamUrl.toString(), {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: method === 'POST' ? JSON.stringify(req.body) : undefined,
                    signal: controller.signal,
                });
                const payload = await upstream.text();
                res.status(upstream.status).type('application/json').send(payload);
            } catch (error: unknown) {
                res.status(502).json({ error: 'Autonomous agent unavailable: ' + String(error) });
            } finally { clearTimeout(timer); }
        };
        this.mainApp.post('/ai-agent/autonomy/start', (req, res) => { void autonomyProxy(req,res,'/autonomy/start','POST'); });
        this.mainApp.post('/ai-agent/autonomy/stop', (req, res) => { void autonomyProxy(req,res,'/autonomy/stop','POST'); });
        this.mainApp.get('/ai-agent/autonomy/status', (req, res) => { void autonomyProxy(req,res,'/autonomy/status','GET'); });
        this.mainApp.get('/ai-agent/autonomy/history', (req, res) => { void autonomyProxy(req,res,'/autonomy/history','GET'); });

        if (HttpServer.SERVE_STATIC && HttpServer.PUBLIC_DIR) {
            this.mainApp.use(PATHNAME, express.static(HttpServer.PUBLIC_DIR));

            /// #if USE_WDA_MJPEG_SERVER

            const { MjpegProxyFactory } = await import('../mw/MjpegProxyFactory');
            this.mainApp.get('/mjpeg/:udid', new MjpegProxyFactory().proxyRequest);
            /// #endif
        }
        const config = Config.getInstance();
        config.servers.forEach((serverItem) => {
            const { secure, port, redirectToSecure } = serverItem;
            let proto: string;
            let server: http.Server | https.Server;
            if (secure) {
                if (!serverItem.options) {
                    throw Error('Must provide option for secure server configuration');
                }
                server = https.createServer(serverItem.options, this.mainApp);
                proto = 'https';
            } else {
                const options = serverItem.options ? { ...serverItem.options } : {};
                proto = 'http';
                let currentApp = this.mainApp;
                let host = '';
                let port = 443;
                let doRedirect = false;
                if (redirectToSecure === true) {
                    doRedirect = true;
                } else if (typeof redirectToSecure === 'object') {
                    doRedirect = true;
                    if (typeof redirectToSecure.port === 'number') {
                        port = redirectToSecure.port;
                    }
                    if (typeof redirectToSecure.host === 'string') {
                        host = redirectToSecure.host;
                    }
                }
                if (doRedirect) {
                    currentApp = express();
                    currentApp.use(function (req, res) {
                        const url = new URL(`https://${host ? host : req.headers.host}${req.url}`);
                        if (port && port !== 443) {
                            url.port = port.toString();
                        }
                        return res.redirect(301, url.toString());
                    });
                }
                server = http.createServer(options, currentApp);
            }
            this.servers.push({ server, port });
            server.listen(port, () => {
                Utils.printListeningMsg(proto, port, PATHNAME);
            });
        });
        this.started = true;
        this.emit('started', true);
    }

    public release(): void {
        VisualAgentService.stop();
        this.servers.forEach((item) => {
            item.server.close();
        });
    }
}
