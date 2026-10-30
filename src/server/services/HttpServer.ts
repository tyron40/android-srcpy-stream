import * as http from 'http';
import * as https from 'https';
import path from 'path';
import { Service } from './Service';
import { Utils } from '../Utils';
import express, { Express } from 'express';
import { Config } from '../Config';
import { TypedEmitter } from '../../common/TypedEmitter';
import * as process from 'process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
const execAdb = promisify(execFile);
const legacySerial = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const localOnly = (address?: string): boolean => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
        this.mainApp = express();
        this.mainApp.use(express.json({ limit: '1mb' }));
        // Allow the public dashboard to communicate with the companion on the user's own PC.
        this.mainApp.use((req, res, next) => {
            const origin = req.headers.origin;
            if (origin === 'https://android-srcpy-control-center.onrender.com') {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                res.setHeader('Access-Control-Allow-Private-Network', 'true');
            }
            if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
            next();
        });

        // Android 4.x compatibility mode: ADB screenshots and input, no modern scrcpy server.
        this.mainApp.get('/legacy', (_req, res) => {
            res.type('html').send(legacyHtml);
        });
        this.mainApp.get('/legacy/screen/:serial', async (req, res) => {
            if (!localOnly(req.socket.remoteAddress)) return res.sendStatus(403);
            const serial = req.params.serial;
            if (!legacySerial(serial)) return res.sendStatus(400);
            const temp = path.join(os.tmpdir(), 'dcc-' + process.pid + '-' + Date.now() + '.png');
            try {
                // Use file transfer fallback for old Android versions that do not support exec-out.
                await execAdb('adb', ['-s', serial, 'shell', 'screencap', '-p', '/sdcard/dcc-screen.png'], { timeout: 12000, windowsHide: true });
                await execAdb('adb', ['-s', serial, 'pull', '/sdcard/dcc-screen.png', temp], { timeout: 12000, windowsHide: true });
                const data = fs.readFileSync(temp);
                if (data.length < 24 || data.subarray(1, 4).toString() !== 'PNG') throw Error('Invalid PNG screenshot');
                res.setHeader('Cache-Control', 'no-store');
                res.type('png').send(data);
            } catch (error: unknown) {
                res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
            } finally { try { fs.unlinkSync(temp); } catch (_) { /* cleanup */ } }
        });
        this.mainApp.post('/legacy/input/:serial', async (req, res) => {
            if (!localOnly(req.socket.remoteAddress)) return res.sendStatus(403);
            const serial = req.params.serial;
            if (!legacySerial(serial)) return res.sendStatus(400);
            const body = req.body || {};
            let args: string[];
            if (body.type === 'key' && [3, 4, 26, 82, 187].includes(body.keyCode)) {
                args = ['-s', serial, 'shell', 'input', 'keyevent', String(body.keyCode)];
            } else if (body.type === 'tap' && Number.isInteger(body.x) && Number.isInteger(body.y) && body.x >= 0 && body.y >= 0 && body.x <= 5000 && body.y <= 5000) {
                args = ['-s', serial, 'shell', 'input', 'tap', String(body.x), String(body.y)];
            } else { return res.status(400).json({ error: 'Unsupported input' }); }
            try {
                await execAdb('adb', args, { timeout: 8000, windowsHide: true });
                res.json({ ok: true });
            } catch (error: unknown) {
                res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
            }
        });
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
        this.servers.forEach((item) => {
            item.server.close();
        });
    }
}

const legacyHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Legacy Android Control</title><style>body{background:#0b1220;color:#eaf2ff;font:16px system-ui;margin:0;padding:24px}button,select{background:#2877ed;color:white;border:0;padding:12px;margin:5px;border-radius:10px;cursor:pointer}main{max-width:980px;margin:auto}#screen{display:block;max-height:75vh;max-width:100%;margin:20px auto;border:2px solid #384967;cursor:crosshair}#status{color:#abc1dc}</style></head><body><main><h1>Legacy Android Control</h1><p>Android 4.x compatibility • screenshot refresh and ADB input</p><select id="device"></select><button onclick="refresh()">Refresh devices</button><button onclick="sendKey(3)">Home</button><button onclick="sendKey(4)">Back</button><button onclick="sendKey(26)">Power</button><button onclick="sendKey(82)">Menu</button><p id="status">Connecting…</p><img id="screen" alt="Device screenshot; click to tap phone" /></main><script>
const device=document.getElementById('device'),screen=document.getElementById('screen'),status=document.getElementById('status');let busy=false;
async function refresh(){try{const r=await fetch('/devices');const j=await r.json();device.replaceChildren();for(const id of j.devices||[]){const o=document.createElement('option');o.value=id;o.textContent=id;device.append(o);}status.textContent=device.value?'Connected: '+device.value:'No authorized Android devices';}catch(e){status.textContent='Device detection failed: '+e.message;}}
async function send(body){if(!device.value)return;try{const r=await fetch('/legacy/input/'+encodeURIComponent(device.value),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());status.textContent='Command sent: '+body.type;}catch(e){status.textContent='Input failed: '+e.message;}}
function sendKey(keyCode){send({type:'key',keyCode});}
screen.addEventListener('click',e=>{if(!screen.naturalWidth)return;const rect=screen.getBoundingClientRect();send({type:'tap',x:Math.round((e.clientX-rect.left)/rect.width*screen.naturalWidth),y:Math.round((e.clientY-rect.top)/rect.height*screen.naturalHeight)});});
async function frame(){if(busy||!device.value)return;busy=true;try{const r=await fetch('/legacy/screen/'+encodeURIComponent(device.value)+'?t='+Date.now());if(!r.ok)throw Error(await r.text());const blob=await r.blob();const u=URL.createObjectURL(blob);const old=screen.src;screen.onload=()=>{if(old.startsWith('blob:'))URL.revokeObjectURL(old);};screen.src=u;status.textContent='Screen updated: '+new Date().toLocaleTimeString();}catch(e){status.textContent='Screen capture failed: '+e.message;}finally{busy=false;}}
device.onchange=()=>{screen.removeAttribute('src');frame();};refresh().then(frame);setInterval(frame,1800);
</script></body></html>`;
