import { BaseClient } from '../../client/BaseClient';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { GoogMoreBox } from '../toolbox/GoogMoreBox';
import { GoogToolBox } from '../toolbox/GoogToolBox';
import VideoSettings from '../../VideoSettings';
import Size from '../../Size';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import { ClientsStats, DisplayCombinedInfo } from '../../client/StreamReceiver';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import Util from '../../Util';
import FilePushHandler from '../filePush/FilePushHandler';
import DragAndPushLogger from '../DragAndPushLogger';
import { KeyEventListener, KeyInputHandler } from '../KeyInputHandler';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { BasePlayer, PlayerClass } from '../../player/BasePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ConfigureScrcpy } from './ConfigureScrcpy';
import { DeviceTracker } from './DeviceTracker';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { html } from '../../ui/HtmlTag';
import {
    FeaturedInteractionHandler,
    InteractionHandlerListener,
} from '../../interactionHandler/FeaturedInteractionHandler';
import DeviceMessage from '../DeviceMessage';
import { DisplayInfo } from '../../DisplayInfo';
import { Attribute } from '../../Attribute';
import { HostTracker } from '../../client/HostTracker';
import { ACTION } from '../../../common/Action';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { ScrcpyFilePushStream } from '../filePush/ScrcpyFilePushStream';
import { MultiDeviceSyncManager } from './MultiDeviceSyncManager';
import { MirrorAction } from '../../../types/MirrorAction';

type StartParams = {
    udid: string;
    playerName?: string;
    player?: BasePlayer;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
};

const TAG = '[StreamClientScrcpy]';

export class StreamClientScrcpy
    extends BaseClient<ParamsStreamScrcpy, never>
    implements KeyEventListener, InteractionHandlerListener
{
    public static ACTION = 'stream';
    private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();

    private controlButtons?: HTMLElement;
    private deviceName = '';
    private clientId = -1;
    private clientsCount = -1;
    private joinedStream = false;
    private requestedVideoSettings?: VideoSettings;
    private touchHandler?: FeaturedInteractionHandler;
    private moreBox?: GoogMoreBox;
    private player?: BasePlayer;
    private filePushHandler?: FilePushHandler;
    private fitToScreen?: boolean;
    private readonly streamReceiver: StreamReceiverScrcpy;
    private readonly syncManager = new MultiDeviceSyncManager();
    private deviceView?: HTMLElement;
    private syncControls?: HTMLElement;
    private pointerStart?: { x: number; y: number; t: number };
    private readonly pointerMoveThreshold = 12;
    private readonly minSwipeDurationMs = 120;

    public static registerPlayer(playerClass: PlayerClass): void {
        if (playerClass.isSupported()) {
            this.players.set(playerClass.playerFullName, playerClass);
        }
    }

    public static getPlayers(): PlayerClass[] {
        return Array.from(this.players.values());
    }

    private static getPlayerClass(playerName: string): PlayerClass | undefined {
        let playerClass: PlayerClass | undefined;
        for (const value of StreamClientScrcpy.players.values()) {
            if (value.playerFullName === playerName || value.playerCodeName === playerName) {
                playerClass = value;
            }
        }
        return playerClass;
    }

    public static createPlayer(playerName: string, udid: string, displayInfo?: DisplayInfo): BasePlayer | undefined {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return;
        }
        return new playerClass(udid, displayInfo);
    }

    public static getFitToScreen(playerName: string, udid: string, displayInfo?: DisplayInfo): boolean {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return false;
        }
        return playerClass.getFitToScreenStatus(udid, displayInfo);
    }

    public static start(
        query: URLSearchParams | ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ): StreamClientScrcpy {
        if (query instanceof URLSearchParams) {
            const params = StreamClientScrcpy.parseParameters(query);
            return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
        } else {
            return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
        }
    }

    private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
        return new VideoSettings({
            crop: old.crop,
            bitrate: old.bitrate,
            bounds: newBounds,
            maxFps: old.maxFps,
            iFrameInterval: old.iFrameInterval,
            sendFrameMeta: old.sendFrameMeta,
            lockedVideoOrientation: old.lockedVideoOrientation,
            displayId: old.displayId,
            codecOptions: old.codecOptions,
            encoderName: old.encoderName,
        });
    }

    protected constructor(
        params: ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ) {
        super(params);
        if (streamReceiver) {
            this.streamReceiver = streamReceiver;
        } else {
            this.streamReceiver = new StreamReceiverScrcpy(this.params);
        }

        const { udid, player: playerName } = this.params;
        this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
        this.setBodyClass('stream');
    }

    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
        };
    }

    public OnDeviceMessage = (message: DeviceMessage): void => {
        if (this.moreBox) {
            this.moreBox.OnDeviceMessage(message);
        }
    };

    public onVideo = (data: ArrayBuffer): void => {
        if (!this.player) {
            return;
        }
        const STATE = BasePlayer.STATE;
        if (this.player.getState() === STATE.PAUSED) {
            this.player.play();
        }
        if (this.player.getState() === STATE.PLAYING) {
            this.player.pushFrame(new Uint8Array(data));
        }
    };

    public onClientsStats = (stats: ClientsStats): void => {
        this.deviceName = stats.deviceName;
        this.clientId = stats.clientId;
        this.setTitle(`Stream ${this.deviceName}`);
    };

    public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        if (!this.player) {
            return;
        }
        let currentSettings = this.player.getVideoSettings();
        const displayId = currentSettings.displayId;
        const info = infoArray.find((value) => {
            return value.displayInfo.displayId === displayId;
        });
        if (!info) {
            return;
        }
        if (this.player.getState() === BasePlayer.STATE.PAUSED) {
            this.player.play();
        }
        const { videoSettings, screenInfo } = info;
        this.player.setDisplayInfo(info.displayInfo);
        if (typeof this.fitToScreen !== 'boolean') {
            this.fitToScreen = this.player.getFitToScreenStatus();
        }
        if (this.fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                currentSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, newBounds);
                this.player.setVideoSettings(currentSettings, this.fitToScreen, false);
            }
        }
        if (!videoSettings || !screenInfo) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(currentSettings));
            return;
        }

        this.clientsCount = info.connectionCount;
        let min = VideoSettings.copy(videoSettings);
        const oldInfo = this.player.getScreenInfo();
        if (!screenInfo.equals(oldInfo)) {
            this.player.setScreenInfo(screenInfo);
        }

        if (!videoSettings.equals(currentSettings)) {
            this.applyNewVideoSettings(videoSettings, videoSettings.equals(this.requestedVideoSettings));
        }
        if (!oldInfo) {
            const bounds = currentSettings.bounds;
            const videoSize: Size = screenInfo.videoSize;
            const onlyOneClient = this.clientsCount === 0;
            const smallerThenCurrent = bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
            if (onlyOneClient || smallerThenCurrent) {
                min = currentSettings;
            }
            const minBounds = currentSettings.bounds?.intersect(min.bounds);
            if (minBounds && !minBounds.equals(min.bounds)) {
                min = StreamClientScrcpy.createVideoSettingsWithBounds(min, minBounds);
            }
        }
        if (!min.equals(videoSettings) || !this.joinedStream) {
            this.joinedStream = true;
            this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(min));
        }
    };

    public onDisconnected = (): void => {
        this.streamReceiver.off('deviceMessage', this.OnDeviceMessage);
        this.streamReceiver.off('video', this.onVideo);
        this.streamReceiver.off('clientsStats', this.onClientsStats);
        this.streamReceiver.off('displayInfo', this.onDisplayInfo);
        this.streamReceiver.off('disconnected', this.onDisconnected);

        this.filePushHandler?.release();
        this.filePushHandler = undefined;
        this.touchHandler?.release();
        this.touchHandler = undefined;
        this.syncManager.release();
        this.pointerStart = undefined;

        if (this.syncControls && this.syncControls.parentElement) {
            this.syncControls.parentElement.removeChild(this.syncControls);
        }
        this.syncControls = undefined;

        if (this.deviceView) {
            const card = this.deviceView.closest('.sync-device-card');
            if (card && card.parentElement) {
                card.parentElement.removeChild(card);
            } else if (this.deviceView.parentElement) {
                this.deviceView.parentElement.removeChild(this.deviceView);
            }
        }
        this.deviceView = undefined;
    };

    public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }

        this.fitToScreen = fitToScreen;
        if (!player) {
            if (typeof playerName !== 'string') {
                throw Error('Must provide BasePlayer instance or playerName');
            }
            let displayInfo: DisplayInfo | undefined;
            if (this.streamReceiver && videoSettings) {
                displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
            }
            const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
            if (!p) {
                throw Error(`Unsupported player: "${playerName}"`);
            }
            if (typeof fitToScreen !== 'boolean') {
                fitToScreen = StreamClientScrcpy.getFitToScreen(playerName, udid, displayInfo);
            }
            player = p;
        }
        this.player = player;
        this.setTouchListeners(player);

        if (!videoSettings) {
            videoSettings = player.getVideoSettings();
        }

        const deviceView = document.createElement('div');
        deviceView.className = 'device-view';
        this.deviceView = deviceView;

        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            let parent;
            parent = deviceView.parentElement;
            if (parent) {
                parent.removeChild(deviceView);
            }
            parent = moreBox.parentElement;
            if (parent) {
                parent.removeChild(moreBox);
            }
            this.streamReceiver.stop();
            if (this.player) {
                this.player.stop();
            }
        };

        const googMoreBox = (this.moreBox = new GoogMoreBox(udid, player, this));
        const moreBox = googMoreBox.getHolderElement();
        googMoreBox.setOnStop(stop);
        const googToolBox = GoogToolBox.createToolBox(udid, player, this, moreBox);
        this.controlButtons = googToolBox.getHolderElement();
        deviceView.appendChild(this.controlButtons);
        const video = document.createElement('div');
        video.className = 'video';
        deviceView.appendChild(video);
        deviceView.appendChild(moreBox);
        player.setParent(video);
        player.pause();

        const workspace = StreamClientScrcpy.getOrCreateWorkspace();
        const card = document.createElement('div');
        card.className = 'sync-device-card';
        const cardHeader = document.createElement('div');
        cardHeader.className = 'sync-device-card-header';
        cardHeader.innerText = udid;
        card.appendChild(cardHeader);
        card.appendChild(deviceView);

        const syncControls = this.createSyncControls(udid);
        this.syncControls = syncControls;
        card.appendChild(syncControls);
        workspace.appendChild(card);

        if (fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                videoSettings = StreamClientScrcpy.createVideoSettingsWithBounds(videoSettings, newBounds);
            }
        }

        this.applyNewVideoSettings(videoSettings, false);

        const element = player.getTouchableElement();
        this.bindMirrorCaptureListeners(element, udid, player);
        const logger = new DragAndPushLogger(element);
        this.filePushHandler = new FilePushHandler(element, new ScrcpyFilePushStream(this.streamReceiver));
        this.filePushHandler.addEventListener(logger);

        const streamReceiver = this.streamReceiver;
        streamReceiver.on('deviceMessage', this.OnDeviceMessage);
        streamReceiver.on('video', this.onVideo);
        streamReceiver.on('clientsStats', this.onClientsStats);
        streamReceiver.on('displayInfo', this.onDisplayInfo);
        streamReceiver.on('disconnected', this.onDisconnected);
        console.log(TAG, player.getName(), udid);
    }

    public sendMessage(message: ControlMessage): void {
        this.streamReceiver.sendEvent(message);
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public setHandleKeyboardEvents(enabled: boolean): void {
        if (enabled) {
            KeyInputHandler.addEventListener(this);
        } else {
            KeyInputHandler.removeEventListener(this);
        }
    }

    public onKeyEvent(event: KeyCodeControlMessage): void {
        this.sendMessage(event);
    }

    private createSyncControls(udid: string): HTMLElement {
        const holder = document.createElement('div');
        holder.className = 'sync-controls';

        const enabledLabel = document.createElement('label');
        enabledLabel.innerText = 'Broadcast my actions from this master to selected targets ';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabledLabel.appendChild(enabled);
        holder.appendChild(enabledLabel);

        const help = document.createElement('div');
        help.className = 'sync-help';
        help.innerText = 'Devices receiving mirrored actions';
        holder.appendChild(help);

        const select = document.createElement('select');
        select.multiple = true;
        select.size = 6;

        const refreshTargets = (): void => {
            const selected = new Set(Array.from(select.selectedOptions).map((opt) => opt.value));
            select.innerHTML = '';
            const streams = DeviceTracker.getKnownDeviceStreams();
            streams.forEach((item) => {
                if (item.udid === udid) {
                    return;
                }
                const option = document.createElement('option');
                option.value = item.udid;
                option.text = item.udid;
                option.selected = selected.has(item.udid);
                select.appendChild(option);
            });
        };

        const applyTargets = (): void => {
            const targets = Array.from(select.selectedOptions).map((opt) => ({ udid: opt.value }));
            this.syncManager.setMasterUdid(udid);
            this.syncManager.setTargets(targets);
        };

        enabled.onchange = () => {
            this.syncManager.setEnabled(enabled.checked);
            select.disabled = !enabled.checked;
            refreshTargets();
            applyTargets();
        };

        select.disabled = true;
        select.onchange = () => {
            refreshTargets();
            applyTargets();
        };

        refreshTargets();
        holder.appendChild(select);
        return holder;
    }

    private bindMirrorCaptureListeners(element: HTMLElement, udid: string, player: BasePlayer): void {
        element.addEventListener('pointerdown', (event: PointerEvent) => {
            this.pointerStart = { x: event.clientX, y: event.clientY, t: Date.now() };
        });

        element.addEventListener('pointerup', async (event: PointerEvent) => {
            if (!this.syncManager.isEnabled()) {
                return;
            }
            if (this.syncManager.getMasterUdid() !== udid) {
                return;
            }
            if (!this.syncManager.getTargetUdids().length) {
                return;
            }

            const start = this.pointerStart;
            this.pointerStart = undefined;
            if (!start) {
                return;
            }

            const endX = event.clientX;
            const endY = event.clientY;
            const dx = endX - start.x;
            const dy = endY - start.y;
            const moved = Math.hypot(dx, dy) >= this.pointerMoveThreshold;

            if (moved) {
                const duration = Math.max(this.minSwipeDurationMs, Date.now() - start.t);
                const action = this.makeSwipeAction(element, player, start.x, start.y, endX, endY, duration);
                if (!action) {
                    return;
                }
                await this.dispatchMirroredAction(udid, action, { sx: start.x, sy: start.y, ex: endX, ey: endY });
                return;
            }

            const action = this.makeTapAction(element, player, endX, endY);
            if (!action) {
                return;
            }
            await this.dispatchMirroredAction(udid, action, { x: endX, y: endY });
        });
    }

    private getDeviceSize(player: BasePlayer): { width: number; height: number } | undefined {
        const info = player.getScreenInfo();
        if (!info) {
            return;
        }
        const size = info.videoSize;
        if (!size || !size.width || !size.height) {
            return;
        }
        return { width: size.width, height: size.height };
    }

    private toDevicePoint(
        element: HTMLElement,
        player: BasePlayer,
        clientX: number,
        clientY: number,
    ): { localX: number; localY: number; x: number; y: number } | undefined {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }
        const deviceSize = this.getDeviceSize(player);
        if (!deviceSize) {
            return;
        }

        const localX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const localY = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const x = Math.round((localX / rect.width) * deviceSize.width);
        const y = Math.round((localY / rect.height) * deviceSize.height);
        return { localX, localY, x, y };
    }

    private makeTapAction(
        element: HTMLElement,
        player: BasePlayer,
        clientX: number,
        clientY: number,
    ): MirrorAction | undefined {
        const p = this.toDevicePoint(element, player, clientX, clientY);
        if (!p) {
            return;
        }
        console.log(
            TAG,
            `Captured tap on master at browser(${clientX},${clientY}) local(${Math.round(p.localX)},${Math.round(
                p.localY,
            )}) device(${p.x},${p.y})`,
        );
        return {
            type: 'tap',
            x: p.x,
            y: p.y,
        };
    }

    private makeSwipeAction(
        element: HTMLElement,
        player: BasePlayer,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
        duration: number,
    ): MirrorAction | undefined {
        const p1 = this.toDevicePoint(element, player, startX, startY);
        const p2 = this.toDevicePoint(element, player, endX, endY);
        if (!p1 || !p2) {
            return;
        }
        console.log(
            TAG,
            `Captured swipe on master browser(${startX},${startY})->(${endX},${endY}) device(${p1.x},${p1.y})->(${p2.x},${p2.y}) duration=${duration}`,
        );
        return {
            type: 'swipe',
            x1: p1.x,
            y1: p1.y,
            x2: p2.x,
            y2: p2.y,
            duration,
        };
    }

    private async dispatchMirroredAction(
        masterSerial: string,
        action: MirrorAction,
        raw: Record<string, number>,
    ): Promise<void> {
        try {
            console.log(TAG, 'Posted mirror-action', {
                masterSerial,
                targetSerials: this.syncManager.getTargetUdids(),
                action,
                raw,
            });
            const result = await this.syncManager.dispatchAction(action);
            if (!result) {
                return;
            }
            result.results.forEach((r) => {
                console.log(TAG, `Target result: ${r.serial} => ${r.ok ? 'success' : 'fail'} ${r.error || ''}`.trim());
            });
        } catch (error) {
            console.error(TAG, 'mirror-action dispatch failed', error);
        }
    }

    private static isChatFocusMode(): boolean {
        const hash = location.hash.replace(/^#!/, '');
        const parsedQuery = new URLSearchParams(hash);
        const focus = (parsedQuery.get('focus') || '').toLowerCase();
        return focus === 'chat';
    }

    private static applyChatFocusModeIfNeeded(workspace: HTMLElement): void {
        if (!this.isChatFocusMode()) {
            return;
        }
        document.body.classList.add('chat-focus-mode');

        const devicesRoot = document.getElementById('devices');
        if (devicesRoot) {
            devicesRoot.classList.add('chat-focus-hidden');
        }
        workspace.classList.add('chat-focus-workspace');
    }

    private static getOrCreateWorkspace(): HTMLElement {
        const id = 'sync-multi-device-workspace';
        const existing = document.getElementById(id);
        if (existing) {
            return existing;
        }
        const workspace = document.createElement('div');
        workspace.id = id;
        workspace.className = 'sync-multi-device-workspace';

        const devicesRoot = document.getElementById('devices');
        if (devicesRoot && devicesRoot.parentElement) {
            if (devicesRoot.nextSibling) {
                devicesRoot.parentElement.insertBefore(workspace, devicesRoot.nextSibling);
            } else {
                devicesRoot.parentElement.appendChild(workspace);
            }
        } else {
            document.body.appendChild(workspace);
        }

        this.applyChatFocusModeIfNeeded(workspace);
        return workspace;
    }

    public sendNewVideoSetting(videoSettings: VideoSettings): void {
        this.requestedVideoSettings = videoSettings;
        this.sendMessage(CommandControlMessage.createSetVideoSettingsCommand(videoSettings));
    }

    public getClientId(): number {
        return this.clientId;
    }

    public getClientsCount(): number {
        return this.clientsCount;
    }

    public getMaxSize(): Size | undefined {
        if (!this.controlButtons) {
            return;
        }
        const body = document.body;
        const width = (body.clientWidth - this.controlButtons.clientWidth) & ~15;
        const height = body.clientHeight & ~15;
        return new Size(width, height);
    }

    private setTouchListeners(player: BasePlayer): void {
        if (this.touchHandler) {
            return;
        }
        this.touchHandler = new FeaturedInteractionHandler(player, this);
    }

    private applyNewVideoSettings(videoSettings: VideoSettings, saveToStorage: boolean): void {
        let fitToScreen = false;
        if (videoSettings.bounds && videoSettings.bounds.equals(this.getMaxSize())) {
            fitToScreen = true;
        }
        if (this.player) {
            this.player.setVideoSettings(videoSettings, fitToScreen, saveToStorage);
        }
    }

    public static createEntryForDeviceList(
        descriptor: GoogDeviceDescriptor,
        blockClass: string,
        fullName: string,
        params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        const hasPid = descriptor.pid !== -1;
        if (hasPid) {
            const configureButtonId = `configure_${Util.escapeUdid(descriptor.udid)}`;
            const e = html`<div class="stream ${blockClass}">
                <button
                    ${Attribute.UDID}="${descriptor.udid}"
                    ${Attribute.COMMAND}="${ControlCenterCommand.CONFIGURE_STREAM}"
                    ${Attribute.FULL_NAME}="${fullName}"
                    ${Attribute.SECURE}="${params.secure}"
                    ${Attribute.HOSTNAME}="${params.hostname}"
                    ${Attribute.PORT}="${params.port}"
                    ${Attribute.PATHNAME}="${params.pathname}"
                    ${Attribute.USE_PROXY}="${params.useProxy}"
                    id="${configureButtonId}"
                    class="active action-button"
                >
                    Configure stream
                </button>
            </div>`;
            const a = e.content.getElementById(configureButtonId);
            a && (a.onclick = this.onConfigureStreamClick);
            return e.content;
        }
        return;
    }

    private static onConfigureStreamClick = (event: MouseEvent): void => {
        const button = event.currentTarget as HTMLAnchorElement;
        const udid = Util.parseStringEnv(button.getAttribute(Attribute.UDID) || '');
        const fullName = button.getAttribute(Attribute.FULL_NAME);
        const secure = Util.parseBooleanEnv(button.getAttribute(Attribute.SECURE) || undefined) || false;
        const hostname = Util.parseStringEnv(button.getAttribute(Attribute.HOSTNAME) || undefined) || '';
        const port = Util.parseIntEnv(button.getAttribute(Attribute.PORT) || undefined);
        const pathname = Util.parseStringEnv(button.getAttribute(Attribute.PATHNAME) || undefined) || '';
        const useProxy = Util.parseBooleanEnv(button.getAttribute(Attribute.USE_PROXY) || undefined);
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }
        if (typeof port !== 'number') {
            throw Error(`Invalid port type: ${typeof port}`);
        }
        const tracker = DeviceTracker.getInstance({
            type: 'android',
            secure,
            hostname,
            port,
            pathname,
            useProxy,
        });
        const descriptor = tracker.getDescriptorByUdid(udid);
        if (!descriptor) {
            return;
        }
        event.preventDefault();
        const elements = document.getElementsByName(`${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`);
        if (!elements || !elements.length) {
            return;
        }
        const select = elements[0] as HTMLSelectElement;
        const optionElement = select.options[select.selectedIndex];
        const ws = optionElement.getAttribute(Attribute.URL);
        const name = optionElement.getAttribute(Attribute.NAME);
        if (!ws || !name) {
            return;
        }
        const options: ParamsStreamScrcpy = {
            udid,
            ws,
            player: '',
            action: ACTION.STREAM_SCRCPY,
            secure,
            hostname,
            port,
            pathname,
            useProxy,
        };
        const dialog = new ConfigureScrcpy(tracker, descriptor, options);
        dialog.on('closed', StreamClientScrcpy.onConfigureDialogClosed);
    };

    private static onConfigureDialogClosed = (event: { dialog: ConfigureScrcpy; result: boolean }): void => {
        event.dialog.off('closed', StreamClientScrcpy.onConfigureDialogClosed);
        if (event.result) {
            HostTracker.getInstance().destroy();
        }
    };
}
