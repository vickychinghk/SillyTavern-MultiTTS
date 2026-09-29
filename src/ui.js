import { isLoopbackEndpoint, normalizeEndpoint } from './media.js';

const STATUS_TEXT = {
    idle: 'Idle',
    preparing: 'Preparing',
    buffering: 'Buffering',
    playing: 'Playing',
    paused: 'Paused',
    completed: 'Complete',
    'action-required': 'Action needed',
};

const REASON_TEXT = {
    autoplay: 'Tap Resume to allow audio playback.',
    'segment-error': 'A segment failed. Retry, Skip, or Stop.',
    'circuit-breaker': 'Repeated segment failures paused new loads.',
    'playback-error': 'Playback failed. Retry or Stop.',
    restore: 'A previous narration position is available. Tap Resume.',
    disabled: 'Enable Narrator first.',
    'no-message': 'No assistant message is available to narrate.',
    endpoint: 'The MultiTTS endpoint is invalid.',
    'background-paused': 'The browser paused media in the background. Tap Resume.',
};

export class NarratorUI {
    constructor({ settingsStore, controller, documentObject = document }) {
        this.settingsStore = settingsStore;
        this.controller = controller;
        this.document = documentObject;
        this.settingsRoot = null;
        this.compactRoot = null;
        this.unsubscribers = [];
        this.notice = '';
    }

    mount() {
        const container = this.document.querySelector('#extensions_settings2')
            || this.document.querySelector('#extensions_settings');
        if (!container) throw new Error('SillyTavern extension settings container was not found.');

        this.settingsRoot = this.document.createElement('div');
        this.settingsRoot.id = 'multitts-narrator-settings';
        this.settingsRoot.className = 'extension_container';
        this.settingsRoot.innerHTML = this.settingsTemplate();
        container.appendChild(this.settingsRoot);

        this.compactRoot = this.document.createElement('div');
        this.compactRoot.id = 'multitts-narrator-controls';
        this.compactRoot.innerHTML = `
            <button type="button" data-action="toggle" class="menu_button" title="Play / Pause">▶</button>
            <button type="button" data-action="stop" class="menu_button" title="Stop">■</button>
            <button type="button" data-action="retry" class="menu_button" title="Retry">↻</button>
            <button type="button" data-action="skip" class="menu_button" title="Skip">≫</button>
            <span data-role="compact-status">Idle</span>`;
        this.document.body.appendChild(this.compactRoot);

        this.bindEvents();
        this.unsubscribers.push(this.controller.subscribe(snapshot => this.render(snapshot)));
        this.unsubscribers.push(this.settingsStore.subscribe(() => this.render(this.controller.getSnapshot())));
        this.render(this.controller.getSnapshot());
    }

    settingsTemplate() {
        return `
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>MultiTTS Narrator</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <label class="checkbox_label"><input type="checkbox" data-setting="enabled"> <span>Enable Narrator</span></label>
            <label class="checkbox_label"><input type="checkbox" data-setting="autoNarrate"> <span>Auto narrate completed assistant replies</span></label>

            <label for="mtn-endpoint">MultiTTS endpoint</label>
            <input id="mtn-endpoint" class="text_pole" data-setting="endpoint" type="text" inputmode="url">
            <small data-role="endpoint-warning"></small>

            <div class="mtn-grid">
              <label>Speed <span data-value="speed"></span><input data-setting="speed" type="range" min="0" max="100"></label>
              <label>Volume <span data-value="volume"></span><input data-setting="volume" type="range" min="0" max="100"></label>
              <label>Pitch <span data-value="pitch"></span><input data-setting="pitch" type="range" min="0" max="100"></label>
            </div>

            <div class="mtn-actions">
              <button type="button" class="menu_button" data-action="narrate">Narrate current</button>
              <button type="button" class="menu_button" data-action="health">Health test</button>
              <button type="button" class="menu_button" data-action="copy-diagnostics">Copy diagnostics</button>
            </div>

            <div class="mtn-status" data-role="status"></div>
            <div class="mtn-notice" data-role="notice"></div>

            <details>
              <summary>Advanced</summary>
              <label>Maximum segment size <span data-value="segmentChars"></span>
                <input data-setting="segmentChars" type="range" min="20" max="200" step="5">
              </label>
              <label>Look-ahead segments <span data-value="lookAhead"></span>
                <input data-setting="lookAhead" type="range" min="1" max="5" step="1">
              </label>
              <label>Maximum simultaneous loads <span data-value="maxInFlight"></span>
                <input data-setting="maxInFlight" type="range" min="1" max="5" step="1">
              </label>
              <label class="checkbox_label"><input type="checkbox" data-setting="retryOnce"> <span>Retry one failed segment once</span></label>
              <label class="checkbox_label"><input type="checkbox" data-setting="debug"> <span>Debug logging (no chat text)</span></label>
              <small>70 characters and 3-way preload are conservative alpha calibration defaults, not claimed device limits.</small>
            </details>
          </div>
        </div>`;
    }

    bindEvents() {
        const root = this.settingsRoot;
        root.addEventListener('input', event => {
            const input = event.target.closest('[data-setting]');
            if (!input || input.dataset.setting === 'endpoint') return;
            this.saveInput(input);
        });
        root.addEventListener('change', event => {
            const input = event.target.closest('[data-setting]');
            if (!input) return;
            if (input.dataset.setting === 'endpoint') {
                try {
                    const endpoint = normalizeEndpoint(input.value);
                    if (!isLoopbackEndpoint(endpoint)) {
                        const ok = this.document.defaultView?.confirm?.('This endpoint is not localhost/loopback. Narrated chat text will be sent to this host. Save it?');
                        if (!ok) {
                            input.value = this.settingsStore.get().endpoint;
                            return;
                        }
                    }
                    this.settingsStore.update({ endpoint });
                    this.setNotice('Endpoint saved.');
                } catch {
                    input.value = this.settingsStore.get().endpoint;
                    this.setNotice('Endpoint must be a valid http/https URL without credentials.');
                }
            } else {
                this.saveInput(input);
            }
        });

        root.querySelector('[data-action="narrate"]').addEventListener('click', () => this.controller.narrateLatestManual());
        root.querySelector('[data-action="health"]').addEventListener('click', async () => {
            this.setNotice('Running local media health test…');
            const ok = await this.controller.runHealthCheck();
            this.setNotice(ok ? 'Health test played successfully.' : 'Health test failed. Check MultiTTS and endpoint access.');
        });
        root.querySelector('[data-action="copy-diagnostics"]').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(this.controller.getDiagnosticsReport());
                this.setNotice('Diagnostics copied. Chat text is not included.');
            } catch {
                this.setNotice('Could not copy diagnostics in this browser context.');
            }
        });

        this.compactRoot.querySelector('[data-action="toggle"]').addEventListener('click', () => {
            const snapshot = this.controller.getSnapshot();
            if (snapshot.status === 'playing') this.controller.pause();
            else if (snapshot.hasSession) this.controller.resume();
            else this.controller.narrateLatestManual();
        });
        this.compactRoot.querySelector('[data-action="stop"]').addEventListener('click', () => this.controller.stop());
        this.compactRoot.querySelector('[data-action="retry"]').addEventListener('click', () => this.controller.retry());
        this.compactRoot.querySelector('[data-action="skip"]').addEventListener('click', () => this.controller.skip());
    }

    saveInput(input) {
        const key = input.dataset.setting;
        if (key === 'retryOnce') {
            this.settingsStore.update({ retryCount: input.checked ? 1 : 0 });
            return;
        }
        const value = input.type === 'checkbox' ? input.checked
            : input.type === 'range' ? Number(input.value)
                : input.value;
        this.settingsStore.update({ [key]: value });
    }

    setNotice(message) {
        this.notice = message;
        const node = this.settingsRoot?.querySelector('[data-role="notice"]');
        if (node) node.textContent = message;
    }

    render(snapshot) {
        const settings = this.settingsStore.get();
        if (!this.settingsRoot || !this.compactRoot) return;

        for (const input of this.settingsRoot.querySelectorAll('[data-setting]')) {
            const key = input.dataset.setting;
            if (key === 'retryOnce') input.checked = settings.retryCount > 0;
            else if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
            else if (this.document.activeElement !== input || input.type === 'range') input.value = settings[key];
        }
        for (const node of this.settingsRoot.querySelectorAll('[data-value]')) {
            node.textContent = settings[node.dataset.value];
        }

        const warning = this.settingsRoot.querySelector('[data-role="endpoint-warning"]');
        warning.textContent = isLoopbackEndpoint(settings.endpoint)
            ? 'Loopback endpoint: chat text stays on-device until MultiTTS forwards it to its selected upstream.'
            : 'Warning: this endpoint is not loopback. Narrated chat text will be sent to that host.';
        warning.classList.toggle('mtn-warning', !isLoopbackEndpoint(settings.endpoint));

        const statusText = STATUS_TEXT[snapshot.status] || snapshot.status;
        const progress = snapshot.total ? ` · ${snapshot.current}/${snapshot.total}` : '';
        const pending = snapshot.pendingAuto ? ' · latest reply queued' : '';
        const reason = snapshot.reason && REASON_TEXT[snapshot.reason] ? ` — ${REASON_TEXT[snapshot.reason]}` : '';
        this.settingsRoot.querySelector('[data-role="status"]').textContent = `${statusText}${progress}${pending}${reason}`;
        this.settingsRoot.querySelector('[data-role="notice"]').textContent = this.notice;

        this.compactRoot.hidden = !settings.enabled;
        const toggle = this.compactRoot.querySelector('[data-action="toggle"]');
        toggle.textContent = snapshot.status === 'playing' ? 'Ⅱ' : '▶';
        toggle.disabled = snapshot.status === 'action-required' && snapshot.reason !== 'autoplay';
        this.compactRoot.querySelector('[data-action="stop"]').disabled = !snapshot.canStop;
        this.compactRoot.querySelector('[data-action="retry"]').hidden = !snapshot.canRetry;
        this.compactRoot.querySelector('[data-action="skip"]').disabled = !snapshot.canSkip;
        this.compactRoot.querySelector('[data-role="compact-status"]').textContent = `${statusText}${progress}`;

        const health = this.settingsRoot.querySelector('[data-action="health"]');
        health.disabled = snapshot.healthBusy;
    }

    dispose() {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
        this.settingsRoot?.remove();
        this.compactRoot?.remove();
        this.settingsRoot = null;
        this.compactRoot = null;
    }
}
