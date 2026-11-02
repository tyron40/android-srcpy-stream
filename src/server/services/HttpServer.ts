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

        // Put a visible compatibility viewer link on the classic ws-scrcpy interface.
        this.mainApp.get('/legacy/link/:serial', (req, res) => {
            if (!localOnly(req.socket.remoteAddress)) { res.sendStatus(403); return; }
            if (!legacySerial(req.params.serial)) { res.sendStatus(400); return; }
            res.redirect('/legacy/view/' + encodeURIComponent(req.params.serial));
        });
        // Android 4.x compatibility mode: ADB screenshots and input, no modern scrcpy server.
        this.mainApp.get('/legacy', (_req, res) => {
            res.type('html').send(legacyHtml.replace('window.__PREFERRED_SERIAL__', 'null'));
        });
        this.mainApp.get('/legacy/view/:serial', (req, res) => {
            if (!localOnly(req.socket.remoteAddress)) { res.sendStatus(403); return; }
            if (!legacySerial(req.params.serial)) { res.sendStatus(400); return; }
            res.type('html').send(legacyHtml.replace('window.__PREFERRED_SERIAL__', JSON.stringify(req.params.serial)));
        });
        this.mainApp.get('/legacy/screen/:serial', async (req, res) => {
            if (!localOnly(req.socket.remoteAddress)) { res.sendStatus(403); return; }
            const serial = req.params.serial;
            if (!legacySerial(serial)) { res.sendStatus(400); return; }
            const temp = path.join(os.tmpdir(), 'dcc-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.png');
            try {
                // Use file transfer fallback for old Android versions that do not support exec-out.
                const remote = '/sdcard/dcc-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.png';
                try {
                    await execAdb('adb', ['-s', serial, 'shell', 'screencap', '-p', remote], { timeout: 12000, windowsHide: true });
                    await execAdb('adb', ['-s', serial, 'pull', remote, temp], { timeout: 12000, windowsHide: true });
                } finally {
                    execAdb('adb', ['-s', serial, 'shell', 'rm', '-f', remote], { timeout: 4000, windowsHide: true }).catch(() => undefined);
                }
                const data = fs.readFileSync(temp);
                if (data.length < 24 || data.subarray(1, 4).toString() !== 'PNG') throw Error('Invalid PNG screenshot');
                res.setHeader('Cache-Control', 'no-store');
                res.type('png').send(data);
            } catch (error: unknown) {
                res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
            } finally { try { fs.unlinkSync(temp); } catch (_) { /* cleanup */ } }
        });
        this.mainApp.post('/legacy/input/:serial', async (req, res) => {
            if (!localOnly(req.socket.remoteAddress)) { res.sendStatus(403); return; }
            const serial = req.params.serial;
            if (!legacySerial(serial)) { res.sendStatus(400); return; }
            const body = req.body || {};
            let args: string[];
            if (body.type === 'key' && [3, 4, 26, 82, 187].includes(body.keyCode)) {
                args = ['-s', serial, 'shell', 'input', 'keyevent', String(body.keyCode)];
            } else if (body.type === 'tap' && Number.isInteger(body.x) && Number.isInteger(body.y) && body.x >= 0 && body.y >= 0 && body.x <= 5000 && body.y <= 5000) {
                args = ['-s', serial, 'shell', 'input', 'tap', String(body.x), String(body.y)];
            } else if (body.type === 'text' && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= 200 && /^[\\x20-\\x7E]+$/.test(body.text)) {
                // ADB input text uses %s to represent spaces; keep one short command per keystroke.
                args = ['-s', serial, 'shell', 'input', 'text', body.text.replace(/ /g, '%s')];
            } else if (body.type === 'keyboard' && [7, 21, 22, 66, 67, 61, 62, 111, 112, 122, 123].includes(body.keyCode)) {
                args = ['-s', serial, 'shell', 'input', 'keyevent', String(body.keyCode)];
            } else if (body.type === 'swipe' && [body.x1, body.y1, body.x2, body.y2].every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 5000) && Number.isInteger(body.duration) && body.duration >= 80 && body.duration <= 5000) {
                args = ['-s', serial, 'shell', 'input', 'swipe', String(body.x1), String(body.y1), String(body.x2), String(body.y2), String(body.duration)];
            } else { res.status(400).json({ error: 'Unsupported input' }); return; }
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

const legacyHtml = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Device Control Center</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1120;color:#edf4ff;font:14px system-ui,sans-serif}header{padding:18px 24px;background:#121e34;border-bottom:1px solid #283954;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}h1{font-size:21px;margin:0}header p{color:#a9bed8;margin:4px 0 0}a{color:#b4d3ff}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 24px;background:#101a2d;border-bottom:1px solid #283954}button,select,input{font:inherit;border-radius:9px;border:1px solid #395172;padding:10px 12px;background:#1c304e;color:#fff}button{cursor:pointer}button:hover{background:#28507d}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #72bbff}select{min-width:130px}.workspace{padding:20px;display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}.phone{background:#16233a;border:1px solid #30435f;border-radius:16px;padding:12px;min-width:0;flex:0 0 auto;max-width:100%}.phone-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}.phone-head strong{font-size:13px;overflow-wrap:anywhere}.screen-wrap{background:#05070b;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:130px}.screen-wrap img{display:block;width:100%;height:auto;cursor:pointer;touch-action:none;user-select:none;-webkit-user-drag:none}.controls{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.controls button{flex:1;padding:9px}.keyboard{display:flex;gap:8px;margin-top:10px}.keyboard input{min-width:0;flex:1}.keyboard button{white-space:nowrap}.hint{color:#9eb4d1;font-size:12px;margin:10px 0 0}.status{padding:12px 24px;color:#b8cce4}#device{max-width:250px}.sizes{display:flex;gap:6px;align-items:center}.sizes button[aria-pressed=true]{background:#2774c7;border-color:#74bcff}.phone:focus-within{border-color:#62aafa}@media(max-width:600px){.workspace{padding:10px}.toolbar{padding:12px}.phone{width:100%!important}.screen-wrap{max-width:100%}}
</style></head><body>
<header><div><h1>Device Control Center</h1><p>Android 4 compatibility · Interactive screen control</p></div><a href="/">Classic device tools</a></header>
<div class="toolbar"><label>Device <select id="device"></select></label><button id="refresh">Refresh devices</button><label>Layout <select id="layout"><option value="grid">Grid</option><option value="row">Horizontal</option><option value="column">Vertical</option></select></label><div class="sizes"><span>Phone size</span><button data-size="220">Small</button><button data-size="300">Medium</button><button data-size="420">Large</button></div><button id="add">Add viewer</button></div>
<p id="status" class="status" role="status">Connecting to local companion…</p><div class="workspace" id="workspace"></div>
<script>
const device=document.getElementById('device'),status=document.getElementById('status'),workspace=document.getElementById('workspace');let width=220,serials=[],viewers=new Map();
const preferredSerial=window.__PREFERRED_SERIAL__;
function report(message){status.textContent=message;}
async function send(serial,body){try{const r=await fetch('/legacy/input/'+encodeURIComponent(serial),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());}catch(e){report('Input failed on '+serial+': '+e.message);}}
function createViewer(serial){if(viewers.has(serial))return;const card=document.createElement('section');card.className='phone';card.style.width=width+'px';card.tabIndex=0;const head=document.createElement('div');head.className='phone-head';const name=document.createElement('strong');name.textContent=serial;const close=document.createElement('button');close.textContent='×';close.title='Close this viewer';head.append(name,close);
const wrap=document.createElement('div');wrap.className='screen-wrap';const img=document.createElement('img');img.alt='Live screenshots for '+serial;img.style.cursor='pointer';wrap.append(img);

const keyboard=document.createElement('form');keyboard.className='keyboard';const input=document.createElement('input');input.placeholder='Type on phone…';input.setAttribute('aria-label','Text to type on '+serial);input.maxLength=200;keyboard.append(input);keyboard.addEventListener('submit',e=>{e.preventDefault();const value=input.value;if(value.trim()){send(serial,{type:'text',text:value});input.value='';}});
const hint=document.createElement('p');hint.className='hint';hint.textContent='Tap or drag directly on the screen · Hold for long press · Type in the field and press Enter';card.append(head,wrap,keyboard,hint);workspace.append(card);
const state={card,img,serial,busy:false,timer:null,active:true,pointer:null,url:null};viewers.set(serial,state);close.addEventListener('click',()=>{state.active=false;clearInterval(state.timer);if(state.url)URL.revokeObjectURL(state.url);card.remove();viewers.delete(serial);});
function coords(e){const r=img.getBoundingClientRect();return {x:Math.max(0,Math.min(5000,Math.round((e.clientX-r.left)/r.width*img.naturalWidth))),y:Math.max(0,Math.min(5000,Math.round((e.clientY-r.top)/r.height*img.naturalHeight)))};}
img.addEventListener('pointerdown',e=>{if(!img.naturalWidth||state.pointer)return;state.pointer={id:e.pointerId,point:coords(e),time:performance.now()};img.setPointerCapture(e.pointerId);e.preventDefault();});
img.addEventListener('pointerup',e=>{const p=state.pointer;if(!p||p.id!==e.pointerId)return;state.pointer=null;const end=coords(e),duration=performance.now()-p.time,dist=Math.hypot(end.x-p.point.x,end.y-p.point.y);if(dist<20&&duration<600)send(serial,{type:'tap',x:end.x,y:end.y});else send(serial,{type:'swipe',x1:p.point.x,y1:p.point.y,x2:end.x,y2:end.y,duration:Math.max(80,Math.min(5000,Math.round(duration)))});e.preventDefault();});
img.addEventListener('pointercancel',()=>{state.pointer=null;});img.addEventListener('dragstart',e=>e.preventDefault());
card.addEventListener('keydown',e=>{if(e.target!==card)return;const keys={Enter:66,Backspace:67,Escape:4,ArrowLeft:21,ArrowRight:22,Tab:61,' ':62,Delete:112};const key=keys[e.key];if(key){e.preventDefault();send(serial,{type:'keyboard',keyCode:key});return;}if(e.key.length===1&&/^[ -~]$/.test(e.key)){e.preventDefault();send(serial,{type:'text',text:e.key});}});
async function frame(){if(state.busy||!state.active||document.hidden||state.pointer)return;state.busy=true;try{const r=await fetch('/legacy/screen/'+encodeURIComponent(serial)+'?t='+Date.now());if(!r.ok)throw Error(await r.text());const blob=await r.blob();const u=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=()=>reject(Error('Invalid PNG'));probe.src=u;});if(!state.active){URL.revokeObjectURL(u);return;}img.src=u;if(state.url)URL.revokeObjectURL(state.url);state.url=u;report('Screen updated · '+serial+' · '+new Date().toLocaleTimeString());}catch(e){report('Screen capture failed · '+serial+' · '+e.message);}finally{state.busy=false;}}
frame();state.timer=setInterval(frame,900);}
async function refresh(){try{const r=await fetch('/devices');if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();serials=Array.isArray(j.devices)?j.devices:[];const selected=device.value;device.replaceChildren();for(const id of serials){const option=document.createElement('option');option.value=id;option.textContent=id;device.append(option);}if(serials.includes(selected))device.value=selected;else if(preferredSerial&&serials.includes(preferredSerial))device.value=preferredSerial;report(serials.length?serials.length+' device(s) detected. Select a phone and choose Add viewer.':'No authorized devices. Check USB debugging and ADB authorization.');if(!viewers.size&&device.value)createViewer(device.value);}catch(e){report('Cannot connect to local companion: '+e.message);}}
document.getElementById('refresh').addEventListener('click',refresh);document.getElementById('add').addEventListener('click',()=>{if(device.value)createViewer(device.value);});document.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click',()=>{width=Number(b.dataset.size);document.querySelectorAll('[data-size]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));for(const v of viewers.values())v.card.style.width=width+'px';}));document.querySelector('[data-size="220"]').setAttribute('aria-pressed','true');
document.getElementById('layout').addEventListener('change',e=>{const value=e.target.value;workspace.style.flexDirection=value==='column'?'column':'row';workspace.style.flexWrap=value==='row'?'nowrap':'wrap';workspace.style.overflowX=value==='row'?'auto':'visible';});refresh();
</script></body></html>`;
