import { MirrorAction, MirrorActionResponse } from '../../../types/MirrorAction';

export type MirrorDispatchRequest = {
    masterSerial: string;
    targetSerials: string[];
    action: MirrorAction;
};

export class MultiDeviceSyncManager {
    private enabled = false;
    private masterUdid = '';
    private targetUdids: string[] = [];
    private readonly endpoint = '/mirror-action';

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public setMasterUdid(udid: string): void {
        this.masterUdid = udid;
    }

    public getMasterUdid(): string {
        return this.masterUdid;
    }

    public setTargets(targets: Array<{ udid: string }>): void {
        this.targetUdids = targets.map((target) => target.udid).filter((udid) => !!udid && udid !== this.masterUdid);
    }

    public getTargetUdids(): string[] {
        return [...this.targetUdids];
    }

    public async dispatchAction(action: MirrorAction): Promise<MirrorActionResponse | undefined> {
        if (!this.enabled) {
            return;
        }
        if (!this.masterUdid || !this.targetUdids.length) {
            return;
        }

        const body: MirrorDispatchRequest = {
            masterSerial: this.masterUdid,
            targetSerials: this.targetUdids,
            action,
        };

        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`[MultiDeviceSyncManager] mirror-action failed ${response.status}: ${text}`);
        }

        return (await response.json()) as MirrorActionResponse;
    }

    public release(): void {
        this.targetUdids = [];
    }
}
