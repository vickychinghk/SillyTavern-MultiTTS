import { isLoopbackEndpoint, normalizeEndpoint } from './media.js';

const STATUS_TEXT = {
    idle: '空闲', preparing: '准备中', buffering: '缓冲中',
    playing: '播放中', paused: '已暂停', completed: '播放完成',
    'action-required': '需要处理',
};

const REASON_TEXT = {
    autoplay: '浏览器阻止自动播放，请点击播放。',
    'segment-error': '分段加载失败，请重试或跳过。',
    'circuit-breaker': '连续分段失败，请检查服务。',
    'playback-error': '播放失败，请重试。',
    restore: '已恢复播放位置，请点击播放。',
    disabled: '请在设置中启用旁白。',
    'no-message': '没有可播放的助手回复。',
    endpoint: 'MultiTTS 地址无效。',
    'background-paused': '后台播放已中断，请点击播放。',
};

const POSITION_KEY = 'st-multitts-narrator:position:v1';
const MARGIN = 12;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const PANEL_HTML = [
    '<button type="button" class="mtn-launcher fa-solid fa-headphones" data-action="open" aria-label="打开 MultiTTS" aria-expanded="false" title="MultiTTS · 拖动调整位置"></button>',
    '<section class="mtn-panel" data-role="panel" aria-label="MultiTTS 播放器" hidden>',
    '  <header class="mtn-header"><div><strong>MultiTTS</strong><small>旁白播放器</small></div><button type="button" data-action="close" aria-label="关闭面板" class="mtn-icon fa-solid fa-xmark"></button></header>',
    '  <nav class="mtn-tabs" aria-label="播放器页面"><button type="button" data-tab="player" aria-current="page">播放</button><button type="button" data-tab="settings">设置</button><button type="button" data-tab="logs">日志</button></nav>',
    '  <div class="mtn-page" data-page="player">',
    '    <div class="mtn-now"><span data-role="status">空闲</span><span data-role="progress"></span></div>',
    '    <progress data-role="segment-progress" value="0" max="1" aria-label="分段进度"></progress>',
    '    <div class="mtn-transport">',
    '      <button type="button" data-action="previous" class="mtn-icon fa-solid fa-backward-step" title="上一段" aria-label="上一段"></button>',
    '      <button type="button" data-action="toggle" class="mtn-play fa-solid fa-play" title="播放 / 暂停" aria-label="播放 / 暂停"></button>',
    '      <button type="button" data-action="stop" class="mtn-icon fa-solid fa-stop" title="停止" aria-label="停止"></button>',
    '      <button type="button" data-action="next" class="mtn-icon fa-solid fa-forward-step" title="下一段" aria-label="下一段"></button>',
    '    </div>',
    '    <div class="mtn-row"><button type="button" data-action="narrate" class="mtn-secondary">播放最新回复</button><button type="button" data-action="retry" class="mtn-secondary" hidden>重试当前段</button></div>',
    '    <p class="mtn-hint">点击消息旁的朗读按钮，也可以从任意回复开始。</p>',
    '  </div>',
    '  <div class="mtn-page" data-page="settings" hidden>',
    '    <div class="mtn-options">',
    '      <label class="mtn-switch"><span>启用旁白</span><input data-setting="enabled" type="checkbox"></label>',
    '      <label class="mtn-switch"><span>自动朗读新回复</span><input data-setting="autoNarrate" type="checkbox"></label>',
    '      <label class="mtn-switch"><span>跳过代码块</span><input data-setting="skipCodeBlocks" type="checkbox"></label>',
    '      <label class="mtn-switch"><span>跳过自定义标签内容</span><input data-setting="skipTagBlocks" type="checkbox"></label>',
    '      <label class="mtn-field">MultiTTS 地址<input data-setting="endpoint" type="url" inputmode="url"></label>',
    '      <small data-role="endpoint-warning" class="mtn-hint"></small>',
    '      <label class="mtn-switch"><span>发送语速、音量、音调</span><input data-setting="sendProsodyParams" type="checkbox"></label>',
    '      <div class="mtn-range-group" data-role="prosody-grid">',
    '        <label>语速 <output data-value="speed"></output><input data-setting="speed" type="range" min="0" max="100"></label>',
    '        <label>音量 <output data-value="volume"></output><input data-setting="volume" type="range" min="0" max="100"></label>',
    '        <label>音调 <output data-value="pitch"></output><input data-setting="pitch" type="range" min="0" max="100"></label>',
    '      </div>',
    '      <details><summary>播放优化</summary>',
    '        <div class="mtn-range-group">',
    '          <label>分段字符数 <output data-value="segmentChars"></output><input data-setting="segmentChars" type="range" min="20" max="1000" step="10"></label>',
    '          <label>提前加载段数 <output data-value="lookAhead"></output><input data-setting="lookAhead" type="range" min="1" max="5"></label>',
    '          <label>同时加载上限 <output data-value="maxInFlight"></output><input data-setting="maxInFlight" type="range" min="1" max="5"></label>',
    '          <label class="mtn-switch"><span>失败时自动重试一次</span><input data-setting="retryOnce" type="checkbox"></label>',
    '          <label class="mtn-switch"><span>浏览器控制台日志</span><input data-setting="debug" type="checkbox"></label>',
    '        </div>',
    '      </details>',
    '      <button type="button" class="mtn-secondary" data-action="health">测试语音服务</button>',
    '    </div>',
    '  </div>',
    '  <div class="mtn-page" data-page="logs" hidden>',
    '    <p class="mtn-hint">自动记录并保留最近 2000 条事件；刷新后可查看。记录耗时、间隔和缓冲状态，不保存聊天正文。</p>',
    '    <div class="mtn-row"><button type="button" class="mtn-secondary" data-action="copy-diagnostics">复制完整日志</button><button type="button" class="mtn-secondary mtn-danger" data-action="clear-diagnostics">清空日志</button></div>',
    '    <div data-role="log-count" class="mtn-hint"></div>',
    '    <pre class="mtn-log-preview" data-role="log-preview"></pre>',
    '  </div>',
    '  <p class="mtn-notice" data-role="notice" role="status" aria-live="polite"></p>',
    '</section>',
].join('');

export class NarratorUI {
    constructor({ host, settingsStore, controller, documentObject = document }) {
        this.host = host;
        this.settingsStore = settingsStore;
        this.controller = controller;
        this.document = documentObject;
        this.root = null;
        this.panel = null;
        this.launcher = null;
        this.unsubscribers = [];
        this.notice = '';
        this.lastEnabled = null;
        this.view = 'player';
        this.drag = null;
        this.ignoreClick = false;
        this.onMessageClick = event => {
            const button = event.target.closest?.('.mtn-message-play');
            if (!button) return;
            const message = button.closest('.mes[mesid]');
            const index = Number(message?.getAttribute('mesid'));
            if (!Number.isInteger(index)) return;
            event.preventDefault();
            event.stopPropagation();
            this.controller.record('ui-action', { action: 'message-play', messageIndex: index });
            this.controller.narrateMessage(index);
        };
        this.onOutsideClick = event => {
            if (this.panel && !this.panel.hidden && !this.root.contains(event.target)) this.close();
        };
        this.onKeyDown = event => { if (event.key === 'Escape') this.close(); };
        this.onResize = () => {
            this.setPosition(this.getPosition());
            this.placePanel();
        };
    }

    mount() {
        this.root = this.document.createElement('div');
        this.root.id = 'multitts-narrator-controls';
        this.root.innerHTML = PANEL_HTML;
        this.document.body.appendChild(this.root);
        this.panel = this.root.querySelector('[data-role="panel"]');
        this.launcher = this.root.querySelector('[data-action="open"]');

        // Always show the launcher, even when narration is disabled, so settings remain accessible.
        let saved;
        try { saved = JSON.parse(this.document.defaultView.localStorage.getItem(POSITION_KEY)); } catch {}
        const win = this.document.defaultView;
        this.setPosition(Array.isArray(saved) && saved.length === 2
            ? saved : [win.innerWidth - 68, win.innerHeight - 156]);

        this.root.addEventListener('click', event => this.handleClick(event));
        this.root.addEventListener('change', event => this.handleChange(event));
        this.root.addEventListener('input', event => {
            const input = event.target.closest?.('input[type="range"][data-setting]');
            if (input) {
                const output = this.root.querySelector('[data-value="' + input.dataset.setting + '"]');
                if (output) output.textContent = input.value;
            }
        });
        this.launcher.addEventListener('pointerdown', event => this.startDrag(event));
        this.launcher.addEventListener('pointermove', event => this.moveDrag(event));
        this.launcher.addEventListener('pointerup', event => this.endDrag(event));
        this.launcher.addEventListener('pointercancel', event => this.endDrag(event));
        this.document.addEventListener('click', this.onOutsideClick);
        this.document.addEventListener('keydown', this.onKeyDown);
        this.document.addEventListener('click', this.onMessageClick);
        win.addEventListener('resize', this.onResize);
        this.unsubscribers.push(this.controller.subscribe(snapshot => this.render(snapshot)));
        this.unsubscribers.push(this.settingsStore.subscribe(() => this.render(this.controller.getSnapshot())));
        this.render(this.controller.getSnapshot());
    }

    getPosition() {
        return [parseFloat(this.launcher.style.left) || 0, parseFloat(this.launcher.style.top) || 0];
    }

    setPosition(position) {
        const win = this.document.defaultView;
        const x = Number(position[0]), y = Number(position[1]);
        this.launcher.style.left = clamp(Number.isFinite(x) ? x : 0, MARGIN, Math.max(MARGIN, win.innerWidth - 56 - MARGIN)) + 'px';
        this.launcher.style.top = clamp(Number.isFinite(y) ? y : 0, MARGIN, Math.max(MARGIN, win.innerHeight - 56 - MARGIN)) + 'px';
    }

    startDrag(event) {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, position: this.getPosition(), moved: false };
        this.launcher.setPointerCapture?.(event.pointerId);
    }

    moveDrag(event) {
        const drag = this.drag;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (!drag.moved) return;
        this.setPosition([drag.position[0] + dx, drag.position[1] + dy]);
        this.placePanel();
    }

    endDrag(event) {
        const drag = this.drag;
        if (!drag || drag.id !== event.pointerId) return;
        this.drag = null;
        if (!drag.moved) return;
        this.ignoreClick = true;
        // A completed drag should suppress only the pointer's synthesized click.
        setTimeout(() => { this.ignoreClick = false; }, 0);
        try { this.document.defaultView.localStorage.setItem(POSITION_KEY, JSON.stringify(this.getPosition())); } catch {}
        this.controller.record('ui-position-changed');
    }

    placePanel() {
        if (!this.panel || this.panel.hidden) return;
        const win = this.document.defaultView;
        const [x, y] = this.getPosition();
        const width = this.panel.offsetWidth, height = this.panel.offsetHeight;
        const left = x + 56 + 8 + width + MARGIN <= win.innerWidth ? x + 64 : x - width - 8;
        const top = y + height <= win.innerHeight - MARGIN ? y : y + 56 - height;
        this.panel.style.left = clamp(left, MARGIN, Math.max(MARGIN, win.innerWidth - width - MARGIN)) + 'px';
        this.panel.style.top = clamp(top, MARGIN, Math.max(MARGIN, win.innerHeight - height - MARGIN)) + 'px';
    }

    open() {
        this.panel.hidden = false;
        this.launcher.setAttribute('aria-expanded', 'true');
        this.controller.record('ui-panel-opened');
        this.placePanel();
        this.render(this.controller.getSnapshot());
    }

    close() {
        if (!this.panel || this.panel.hidden) return;
        this.panel.hidden = true;
        this.launcher.setAttribute('aria-expanded', 'false');
    }

    switchView(view) {
        if (!['player', 'settings', 'logs'].includes(view)) return;
        this.view = view;
        for (const page of this.root.querySelectorAll('[data-page]')) page.hidden = page.dataset.page !== view;
        for (const tab of this.root.querySelectorAll('[data-tab]')) {
            if (tab.dataset.tab === view) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        }
        this.controller.record('ui-tab', { tab: view });
        this.render(this.controller.getSnapshot());
        this.placePanel();
    }

    async handleClick(event) {
        const tab = event.target.closest?.('[data-tab]');
        if (tab) { this.switchView(tab.dataset.tab); return; }
        const button = event.target.closest?.('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'open') {
            if (this.ignoreClick) { this.ignoreClick = false; return; }
            if (this.panel.hidden) this.open(); else this.close();
            return;
        }
        if (action === 'close') { this.close(); return; }
        this.controller.record('ui-action', { action });
        switch (action) {
            case 'previous': this.controller.previous(); break;
            case 'next': this.controller.next(); break;
            case 'stop': this.controller.stop(); break;
            case 'retry': this.controller.retry(); break;
            case 'narrate': this.controller.narrateLatestManual(); break;
            case 'toggle': {
                const snapshot = this.controller.getSnapshot();
                if (snapshot.status === 'playing') this.controller.pause();
                else if (snapshot.hasSession) this.controller.resume();
                else this.controller.narrateLatestManual();
                break;
            }
            case 'health': {
                this.setNotice('正在测试语音服务…');
                const ok = await this.controller.runHealthCheck();
                this.setNotice(ok ? '语音服务可正常播放。' : '测试失败，请检查服务地址及浏览器权限。');
                break;
            }
            case 'copy-diagnostics': {
                const report = this.controller.getDiagnosticsReport();
                let copied = false;
                try {
                    await this.document.defaultView.navigator.clipboard.writeText(report);
                    copied = true;
                } catch {
                    // Android HTTP origins may not expose the secure-context Clipboard API.
                    const field = this.document.createElement('textarea');
                    field.value = report;
                    field.setAttribute('readonly', '');
                    field.style.cssText = 'position:fixed;left:-9999px;top:0';
                    this.document.body.appendChild(field);
                    field.select();
                    try { copied = Boolean(this.document.execCommand?.('copy')); } catch {}
                    field.remove();
                }
                this.setNotice(copied ? '完整日志已复制，不包含聊天正文。' : '浏览器禁止自动复制，请使用安全连接后重试。');
                break;
            }
            case 'clear-diagnostics':
                this.controller.clearDiagnostics();
                this.setNotice('诊断日志已清空。');
                this.render(this.controller.getSnapshot());
                break;
        }
    }

    handleChange(event) {
        const input = event.target.closest?.('[data-setting]');
        if (!input) return;
        const key = input.dataset.setting;
        if (key === 'endpoint') {
            try {
                const endpoint = normalizeEndpoint(input.value);
                if (!isLoopbackEndpoint(endpoint)) {
                    const ok = this.document.defaultView.confirm?.('此地址不是本机回环地址，朗读正文会发送到该主机。确定保存？');
                    if (!ok) { input.value = this.settingsStore.get().endpoint; return; }
                }
                this.settingsStore.update({ endpoint });
                this.setNotice('地址已保存。');
            } catch {
                input.value = this.settingsStore.get().endpoint;
                this.setNotice('请输入合法的 http/https 地址，不支持地址中的账号密码。');
            }
            return;
        }
        const value = key === 'retryOnce' ? (input.checked ? 1 : 0)
            : input.type === 'checkbox' ? input.checked
                : input.type === 'range' ? Number(input.value) : input.value;
        const name = key === 'retryOnce' ? 'retryCount' : key;
        this.controller.record('ui-setting-changed', { setting: name, value: name === 'endpoint' ? undefined : value });
        this.settingsStore.update({ [name]: value });
    }

    createMessagePlayButton(nativeNarrate, variant) {
        const button = nativeNarrate?.cloneNode(true) || this.document.createElement('div');
        button.removeAttribute('id');
        button.removeAttribute('data-i18n');
        button.removeAttribute('onclick');
        button.style.removeProperty('display');
        button.hidden = false;
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.classList.remove('mes_narrate');
        button.classList.add('mtn-message-play', 'mes_button', variant);
        if (!button.matches('.fa-solid, .fa-regular')) button.classList.add('fa-solid', 'fa-bullhorn');
        button.title = '用 MultiTTS 播放此消息';
        button.setAttribute('aria-label', '用 MultiTTS 播放此消息');
        return button;
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

        if (!this.settingsStore.get().enabled || !this.host.getMessage(id)) {
            for (const button of message.querySelectorAll('.mtn-message-play')) button.remove();
            return;
        }

        const buttons = message.querySelector('.mes_buttons');
        const nativeNarrate = buttons?.querySelector('.mes_narrate');

        if (buttons && !message.querySelector('.mtn-message-play-actions')) {
            const button = this.createMessagePlayButton(nativeNarrate, 'mtn-message-play-actions');
            if (nativeNarrate) nativeNarrate.insertAdjacentElement('afterend', button);
            else {
                const edit = buttons.querySelector('.mes_edit');
                if (edit) edit.insertAdjacentElement('beforebegin', button);
                else buttons.prepend(button);
            }
        }

        const nameText = message.querySelector('.mes_block .ch_name .name_text, .ch_name .name_text');
        if (nameText && !message.querySelector('.mtn-message-play-name')) {
            nameText.insertAdjacentElement(
                'afterend',
                this.createMessagePlayButton(nativeNarrate, 'mtn-message-play-name'),
            );
        }
    }

    setNotice(message) {
        this.notice = message;
        const node = this.root?.querySelector('[data-role="notice"]');
        if (node) node.textContent = message;
        this.placePanel();
    }

    render(snapshot) {
        if (!this.root || !this.panel) return;
        const settings = this.settingsStore.get();
        for (const input of this.root.querySelectorAll('[data-setting]')) {
            const key = input.dataset.setting === 'retryOnce' ? 'retryCount' : input.dataset.setting;
            if (input.dataset.setting === 'retryOnce') input.checked = settings.retryCount > 0;
            else if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
            else if (this.document.activeElement !== input || input.type === 'range') input.value = settings[key];
        }
        for (const node of this.root.querySelectorAll('[data-value]')) node.textContent = settings[node.dataset.value];
        this.root.querySelector('[data-role="prosody-grid"]').hidden = !settings.sendProsodyParams;
        const warning = this.root.querySelector('[data-role="endpoint-warning"]');
        warning.textContent = isLoopbackEndpoint(settings.endpoint)
            ? '本机地址：文本交由本机 MultiTTS 处理。'
            : '非本机地址：朗读文本将发往该主机。';
        warning.classList.toggle('mtn-warning', !isLoopbackEndpoint(settings.endpoint));

        const statusText = STATUS_TEXT[snapshot.status] || snapshot.status;
        const reason = REASON_TEXT[snapshot.reason] || '';
        this.root.querySelector('[data-role="status"]').textContent = statusText + (reason ? ' · ' + reason : '');
        this.root.querySelector('[data-role="progress"]').textContent = snapshot.total
            ? snapshot.current + ' / ' + snapshot.total + (snapshot.pendingAuto ? ' · 待播新回复' : '') : '';
        const progress = this.root.querySelector('[data-role="segment-progress"]');
        progress.max = Math.max(1, snapshot.total);
        progress.value = snapshot.total ? Math.max(0, snapshot.current - 1) : 0;

        const toggle = this.root.querySelector('[data-action="toggle"]');
        toggle.classList.toggle('fa-play', snapshot.status !== 'playing');
        toggle.classList.toggle('fa-pause', snapshot.status === 'playing');
        this.root.querySelector('[data-action="previous"]').disabled = !snapshot.canPrevious;
        this.root.querySelector('[data-action="next"]').disabled = !snapshot.canNext;
        this.root.querySelector('[data-action="stop"]').disabled = !snapshot.canStop;
        this.root.querySelector('[data-action="retry"]').hidden = !snapshot.canRetry;
        this.root.querySelector('[data-action="health"]').disabled = snapshot.healthBusy;
        this.launcher.classList.toggle('mtn-active', snapshot.status === 'playing');
        this.launcher.classList.toggle('mtn-disabled', !settings.enabled);
        this.root.querySelector('[data-role="notice"]').textContent = this.notice;

        if (this.view === 'logs' && !this.panel.hidden) {
            const events = this.controller.diagnosticsStore?.read() ?? this.controller.diagnostics;
            this.root.querySelector('[data-role="log-count"]').textContent = '已保存 ' + events.length + ' 条事件 · 下方显示最近 30 条';
            this.root.querySelector('[data-role="log-preview"]').textContent = events.slice(-30).map(entry => {
                const fields = Object.entries(entry).filter(([key]) => key !== 'at' && key !== 'event');
                const info = fields.map(([key, value]) => key + '=' + (typeof value === 'object' ? JSON.stringify(value) : value)).join(' ');
                return new Date(entry.at).toLocaleTimeString() + '  ' + entry.event + (info ? '  ' + info : '');
            }).join('\n');
        }
        if (!this.panel.hidden) this.placePanel();
        if (this.lastEnabled !== settings.enabled) {
            this.lastEnabled = settings.enabled;
            this.syncMessageButtons();
        }
    }

    dispose() {
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
        this.document.removeEventListener('click', this.onOutsideClick);
        this.document.removeEventListener('click', this.onMessageClick);
        this.document.removeEventListener('keydown', this.onKeyDown);
        this.document.defaultView.removeEventListener('resize', this.onResize);
        for (const button of this.document.querySelectorAll('.mtn-message-play')) button.remove();
        this.root?.remove();
        this.root = null;
        this.panel = null;
        this.launcher = null;
    }
}
