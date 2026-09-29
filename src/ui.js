import { isLoopbackEndpoint, normalizeEndpoint } from './media.js';

const STATUS_TEXT = {
    idle: '空闲',
    preparing: '准备中',
    buffering: '缓冲中',
    playing: '播放中',
    paused: '已暂停',
    completed: '播放完成',
    'action-required': '需要处理',
};

const REASON_TEXT = {
    autoplay: '请点播放继续，以允许浏览器播放音频。',
    'segment-error': '当前分段加载失败，可重试、下一段或停止。',
    'circuit-breaker': '连续分段失败，已暂停新的加载。',
    'playback-error': '音频播放失败，可重试或停止。',
    restore: '已恢复上次播放位置，请点播放继续。',
    disabled: '请先启用旁白。',
    'no-message': '没有可播放的助手消息。',
    endpoint: 'MultiTTS 地址无效。',
    'background-paused': '浏览器在后台暂停了音频，请点播放继续。',
};

export class NarratorUI {
    constructor({ host, settingsStore, controller, documentObject = document }) {
        this.host = host;
        this.settingsStore = settingsStore;
        this.controller = controller;
        this.document = documentObject;
        this.settingsRoot = null;
        this.compactRoot = null;
        this.unsubscribers = [];
        this.notice = '';
        this.lastEnabled = null;
        this.onMessageClick = event => {
            const button = event.target.closest?.('.mtn-message-play');
            if (!button) return;
            const message = button.closest('.mes[mesid]');
            const index = Number(message?.getAttribute('mesid'));
            if (!Number.isInteger(index)) return;
            event.preventDefault();
            event.stopPropagation();
            this.controller.narrateMessage(index);
        };
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
            <button type="button" data-action="previous" class="menu_button fa-solid fa-backward-step" title="上一段" aria-label="上一段"></button>
            <button type="button" data-action="toggle" class="menu_button fa-solid fa-play" title="播放 / 暂停" aria-label="播放 / 暂停"></button>
            <button type="button" data-action="stop" class="menu_button fa-solid fa-stop" title="停止" aria-label="停止"></button>
            <button type="button" data-action="retry" class="menu_button fa-solid fa-rotate-right" title="重试当前段" aria-label="重试当前段" hidden></button>
            <button type="button" data-action="next" class="menu_button fa-solid fa-forward-step" title="下一段" aria-label="下一段"></button>
            <span data-role="compact-status">空闲</span>`;
        this.document.body.appendChild(this.compactRoot);

        this.bindEvents();
        this.document.addEventListener('click', this.onMessageClick);
        this.unsubscribers.push(this.controller.subscribe(snapshot => this.render(snapshot)));
        this.unsubscribers.push(this.settingsStore.subscribe(() => this.render(this.controller.getSnapshot())));
        this.render(this.controller.getSnapshot());
    }

    settingsTemplate() {
        return `
        <div class="inline-drawer">
          <div class="inline-drawer-toggle inline-drawer-header">
            <b>MultiTTS 旁白</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
          </div>
          <div class="inline-drawer-content">
            <label class="checkbox_label"><input type="checkbox" data-setting="enabled"> <span>启用旁白</span></label>
            <label class="checkbox_label"><input type="checkbox" data-setting="autoNarrate"> <span>自动朗读已完成的助手回复</span></label>

            <label for="mtn-endpoint">MultiTTS 地址</label>
            <input id="mtn-endpoint" class="text_pole" data-setting="endpoint" type="text" inputmode="url">
            <small data-role="endpoint-warning"></small>

            <label class="checkbox_label"><input type="checkbox" data-setting="sendProsodyParams"> <span>发送语速、音量、音调参数</span></label>
            <small>关闭后，<code>/forward</code> 仅发送 <code>text</code> 参数。</small>
            <div class="mtn-grid" data-role="prosody-grid">
              <label>语速 <span data-value="speed"></span><input data-setting="speed" type="range" min="0" max="100"></label>
              <label>音量 <span data-value="volume"></span><input data-setting="volume" type="range" min="0" max="100"></label>
              <label>音调 <span data-value="pitch"></span><input data-setting="pitch" type="range" min="0" max="100"></label>
            </div>

            <div class="mtn-actions">
              <button type="button" class="menu_button" data-action="narrate">播放最新回复</button>
              <button type="button" class="menu_button" data-action="health">健康检查</button>
              <button type="button" class="menu_button" data-action="copy-diagnostics">复制诊断信息</button>
            </div>

            <div class="mtn-status" data-role="status"></div>
            <div class="mtn-notice" data-role="notice"></div>

            <details>
              <summary>高级设置</summary>
              <label>最大分段长度（字符） <span data-value="segmentChars"></span>
                <input data-setting="segmentChars" type="range" min="20" max="1000" step="10">
              </label>
              <label>预加载段数 <span data-value="lookAhead"></span>
                <input data-setting="lookAhead" type="range" min="1" max="5" step="1">
              </label>
              <label>最大同时加载数 <span data-value="maxInFlight"></span>
                <input data-setting="maxInFlight" type="range" min="1" max="5" step="1">
              </label>
              <label class="checkbox_label"><input type="checkbox" data-setting="retryOnce"> <span>失败分段自动重试一次</span></label>
              <label class="checkbox_label"><input type="checkbox" data-setting="debug"> <span>调试日志（不记录聊天正文）</span></label>
              <small>换行优先分段；超长单行优先在完整句末断开。预加载与播放仍严格按原顺序衔接。</small>
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
                        const ok = this.document.defaultView?.confirm?.('此地址不是本机回环地址。朗读的聊天正文会发送到该主机，确定保存吗？');
                        if (!ok) {
                            input.value = this.settingsStore.get().endpoint;
                            return;
                        }
                    }
                    this.settingsStore.update({ endpoint });
                    this.setNotice('地址已保存。');
                } catch {
                    input.value = this.settingsStore.get().endpoint;
                    this.setNotice('请输入不含账号密码的有效 http/https 地址。');
                }
            } else {
                this.saveInput(input);
            }
        });

        root.querySelector('[data-action="narrate"]').addEventListener('click', () => this.controller.narrateLatestManual());
        root.querySelector('[data-action="health"]').addEventListener('click', async () => {
            this.setNotice('正在进行本地音频健康检查…');
            const ok = await this.controller.runHealthCheck();
            this.setNotice(ok ? '健康检查播放成功。' : '健康检查失败，请检查 MultiTTS 和本地地址访问。');
        });
        root.querySelector('[data-action="copy-diagnostics"]').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(this.controller.getDiagnosticsReport());
                this.setNotice('诊断信息已复制，不包含聊天正文。');
            } catch {
                this.setNotice('当前浏览器环境无法复制诊断信息。');
            }
        });

        this.compactRoot.querySelector('[data-action="previous"]').addEventListener('click', () => this.controller.previous());
        this.compactRoot.querySelector('[data-action="toggle"]').addEventListener('click', () => {
            const snapshot = this.controller.getSnapshot();
            if (snapshot.status === 'playing') this.controller.pause();
            else if (snapshot.hasSession) this.controller.resume();
            else this.controller.narrateLatestManual();
        });
        this.compactRoot.querySelector('[data-action="stop"]').addEventListener('click', () => this.controller.stop());
        this.compactRoot.querySelector('[data-action="retry"]').addEventListener('click', () => this.controller.retry());
        this.compactRoot.querySelector('[data-action="next"]').addEventListener('click', () => this.controller.next());
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

    syncMessageButtons() {
        if (!this.settingsStore.get().enabled) {
            for (const button of this.document.querySelectorAll('.mtn-message-play')) button.remove();
            return;
        }
        for (const message of this.document.querySelectorAll('#chat > .mes[mesid]')) {
            this.syncMessageButton(message.getAttribute('mesid'));
        }
    }

    syncMessageButton(index) {
        const id = Number(index);
        if (!Number.isInteger(id)) return;
        const message = this.document.querySelector(`#chat > .mes[mesid="${id}"]`);
        if (!message) return;

        const existing = message.querySelector('.mtn-message-play');
        if (!this.settingsStore.get().enabled || !this.host.getMessage(id)) {
            existing?.remove();
            return;
        }
        if (existing) return;

        const buttons = message.querySelector('.mes_buttons');
        if (!buttons) return;
        const nativeNarrate = buttons.querySelector('.mes_narrate');
        const button = nativeNarrate?.cloneNode(true) || this.document.createElement('div');
        button.removeAttribute('id');
        button.removeAttribute('data-i18n');
        button.removeAttribute('onclick');
        button.style.removeProperty('display');
        button.hidden = false;
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.classList.remove('mes_narrate');
        button.classList.add('mtn-message-play', 'mes_button');
        if (!button.matches('.fa-solid, .fa-regular')) button.classList.add('fa-solid', 'fa-volume-high');
        button.title = '用 MultiTTS 播放此消息';
        button.setAttribute('aria-label', '用 MultiTTS 播放此消息');

        if (nativeNarrate) nativeNarrate.insertAdjacentElement('afterend', button);
        else {
            const edit = buttons.querySelector('.mes_edit');
            if (edit) edit.insertAdjacentElement('beforebegin', button);
            else buttons.prepend(button);
        }
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
        this.settingsRoot.querySelector('[data-role="prosody-grid"]').hidden = !settings.sendProsodyParams;

        const warning = this.settingsRoot.querySelector('[data-role="endpoint-warning"]');
        warning.textContent = isLoopbackEndpoint(settings.endpoint)
            ? '本机回环地址：旁白正文先发送给本机 MultiTTS，再由 MultiTTS 按其配置处理。'
            : '警告：这不是本机回环地址，朗读正文会发送到该主机。';
        warning.classList.toggle('mtn-warning', !isLoopbackEndpoint(settings.endpoint));

        const statusText = STATUS_TEXT[snapshot.status] || snapshot.status;
        const progress = snapshot.total ? ` · ${snapshot.current}/${snapshot.total}` : '';
        const pending = snapshot.pendingAuto ? ' · 已排队最新回复' : '';
        const reason = snapshot.reason && REASON_TEXT[snapshot.reason] ? ` — ${REASON_TEXT[snapshot.reason]}` : '';
        this.settingsRoot.querySelector('[data-role="status"]').textContent = `${statusText}${progress}${pending}${reason}`;
        this.settingsRoot.querySelector('[data-role="notice"]').textContent = this.notice;

        this.compactRoot.hidden = !settings.enabled;
        const toggle = this.compactRoot.querySelector('[data-action="toggle"]');
        const playing = snapshot.status === 'playing';
        toggle.classList.toggle('fa-play', !playing);
        toggle.classList.toggle('fa-pause', playing);
        toggle.disabled = snapshot.status === 'action-required' && snapshot.reason !== 'autoplay';
        this.compactRoot.querySelector('[data-action="previous"]').disabled = !snapshot.canPrevious;
        this.compactRoot.querySelector('[data-action="next"]').disabled = !snapshot.canNext;
        this.compactRoot.querySelector('[data-action="stop"]').disabled = !snapshot.canStop;
        this.compactRoot.querySelector('[data-action="retry"]').hidden = !snapshot.canRetry;
        this.compactRoot.querySelector('[data-role="compact-status"]').textContent = `${statusText}${progress}`;

        this.settingsRoot.querySelector('[data-action="health"]').disabled = snapshot.healthBusy;

        if (this.lastEnabled !== settings.enabled) {
            this.lastEnabled = settings.enabled;
            this.syncMessageButtons();
        }
    }

    dispose() {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
        this.document.removeEventListener('click', this.onMessageClick);
        for (const button of this.document.querySelectorAll('.mtn-message-play')) button.remove();
        this.settingsRoot?.remove();
        this.compactRoot?.remove();
        this.settingsRoot = null;
        this.compactRoot = null;
    }
}
