/** Unified, per-device AI commands inside the existing scrcpy dashboard. */
export class AiAgentPanel {
    private static busy = false;
    private static async devices(select: HTMLSelectElement): Promise<void> {
        try {
            const response = await fetch('/devices');
            if (!response.ok) throw new Error('Device discovery failed');
            const data = (await response.json()) as { devices: string[] };
            const previous = select.value;
            select.replaceChildren();
            for (const serial of data.devices || []) {
                const option = document.createElement('option');
                option.value = serial;
                option.textContent = serial;
                select.appendChild(option);
            }
            if (data.devices.includes(previous)) select.value = previous;
        } catch (error) {
            console.warn('AI device discovery:', error);
        }
    }
    public static start(): void {
        if (document.getElementById('ai-agent-panel')) return;
        const root = document.createElement('aside');
        root.id = 'ai-agent-panel';
        root.innerHTML = `
            <header><strong>Android AI Agent</strong><button id="ai-toggle" type="button" aria-label="Collapse AI panel">−</button></header>
            <div id="ai-panel-content">
              <label for="ai-device">Target device</label><div class="ai-device-row"><select id="ai-device"></select><button id="ai-refresh" type="button">↻</button></div>
              <div id="ai-history" role="log" aria-live="polite"><p>Choose a device and tell the agent what to do. Commands run on your local Android controller.</p></div>
              <section class="ai-autonomy">
                <strong>Always-on mode</strong>
                <label for="ai-goal">Standing instruction</label>
                <textarea id="ai-goal" rows="3" placeholder="Monitor this app and continue reviewing articles as new content appears."></textarea>
                <label for="ai-interval">Observe every (seconds)</label>
                <input id="ai-interval" type="number" min="15" max="3600" value="45" />
                <div class="ai-actions"><button type="button" id="ai-auto-start">Start continuous mode</button><button type="button" id="ai-auto-stop">Stop continuous mode</button></div>
                <small id="ai-auto-status">Continuous mode inactive</small>
              </section>
              <form id="ai-form"><label for="ai-command">Command</label><textarea id="ai-command" rows="3" placeholder="Open Settings and find Wi-Fi"></textarea>
                <div class="ai-actions"><button type="submit" id="ai-send">Run task</button><button type="button" id="ai-stop">Stop</button></div>
              </form><small id="ai-status">Agent must be running locally on port 8003.</small>
            </div>`;
        document.body.appendChild(root);
        const device = root.querySelector<HTMLSelectElement>('#ai-device')!;
        const command = root.querySelector<HTMLTextAreaElement>('#ai-command')!;
        const history = root.querySelector<HTMLElement>('#ai-history')!;
        const status = root.querySelector<HTMLElement>('#ai-status')!;
        const send = root.querySelector<HTMLButtonElement>('#ai-send')!;
        const append = (speaker: string, message: string): void => {
            const item = document.createElement('p');
            const name = document.createElement('b');
            name.textContent = speaker + ': ';
            item.append(name, document.createTextNode(message));
            history.appendChild(item);
            history.scrollTop = history.scrollHeight;
        };
        root.querySelector('#ai-refresh')!.addEventListener('click', () => void this.devices(device));
        root.querySelector('#ai-toggle')!.addEventListener('click', () => root.classList.toggle('ai-collapsed'));
        root.querySelector('#ai-stop')!.addEventListener('click', async () => {
            try {
                const res = await fetch('/ai-agent/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serial: device.value }) });
                if (!res.ok) throw new Error(await res.text());
                append('System', 'Stop requested.');
            } catch (error) { append('Error', String(error)); }
        });
        root.querySelector<HTMLFormElement>('#ai-form')!.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (this.busy) return;
            const task = command.value.trim();
            if (!task || !device.value) { status.textContent = 'Select a device and enter a command.'; return; }
            this.busy = true;
            send.disabled = true;
            append('You', task + ' [' + device.value + ']');
            status.textContent = 'Running task…';
            try {
                const res = await fetch('/ai-agent/run', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task, serial: device.value, max_steps: 15 }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.detail || 'Request failed');
                append('Agent', JSON.stringify(data));
                status.textContent = 'Task finished. Check device screen for result.';
            } catch (error) {
                append('Error', String(error));
                status.textContent = 'Task failed. Verify the local agent is running.';
            } finally { this.busy = false; send.disabled = false; }
        });

        const autoStatus = root.querySelector<HTMLElement>('#ai-auto-status')!;
        const goal = root.querySelector<HTMLTextAreaElement>('#ai-goal')!;
        const interval = root.querySelector<HTMLInputElement>('#ai-interval')!;
        const autoRequest = async (endpoint: string, payload: object): Promise<any> => {
            const response = await fetch('/ai-agent/autonomy/' + endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || data.detail || 'Autonomous request failed');
            return data;
        };
        root.querySelector('#ai-auto-start')!.addEventListener('click', async () => {
            if (!device.value || !goal.value.trim()) { autoStatus.textContent = 'Select a device and enter a standing instruction.'; return; }
            try {
                const result = await autoRequest('start', {
                    serial: device.value, goal: goal.value.trim(),
                    check_seconds: Math.max(15, Math.min(3600, Number(interval.value) || 45)),
                    steps_per_cycle: 8,
                });
                autoStatus.textContent = result.status + ' — continues until stopped';
                append('System', 'Continuous monitoring started on ' + device.value);
            } catch (error) { autoStatus.textContent = String(error); }
        });
        root.querySelector('#ai-auto-stop')!.addEventListener('click', async () => {
            try {
                await autoRequest('stop', { serial: device.value });
                autoStatus.textContent = 'Stop requested';
            } catch (error) { autoStatus.textContent = String(error); }
        });
        const refreshAutonomy = async (): Promise<void> => {
            if (!device.value) return;
            try {
                const response = await fetch('/ai-agent/autonomy/status?serial=' + encodeURIComponent(device.value));
                if (!response.ok) return;
                const data = await response.json();
                autoStatus.textContent = 'Status: ' + data.status + (data.worker_alive ? ' (running)' : '');
                if (data.goal && !goal.value) goal.value = data.goal;
            } catch (_error) { /* Retry on next poll */ }
        };
        device.addEventListener('change', () => { goal.value = ''; void refreshAutonomy(); });
        window.setInterval(() => void refreshAutonomy(), 10000);
        void this.devices(device).then(() => refreshAutonomy());
        window.setInterval(() => { if (!this.busy) void this.devices(device); }, 10000);
    }
}
