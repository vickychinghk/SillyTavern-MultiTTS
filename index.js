/**
 * MultiTTS provider for SillyTavern.
 *
 * Designed for Android MultiTTS local forwarding service:
 *   GET http://127.0.0.1:8774/voices
 *   GET http://127.0.0.1:8774/forward?text=...&speed=...&volume=...&pitch=...&voice=...
 *
 * Requests are made directly by the browser, so this works when SillyTavern itself
 * is hosted on a remote server, as long as the browser is running on the Android
 * device where MultiTTS is installed and its forwarding service is enabled.
 */

import { eventSource, event_types } from '../../../../script.js';
import { registerTtsProvider, saveTtsProviderSettings } from '../../tts/index.js';

const PROVIDER_NAME = 'MultiTTS';
const VERSION = '1.0.0';
const PREVIEW_TEXT = '你好，这是一段 MultiTTS 语音试听。';

let activeController = null;
let registered = false;

function abortActiveRequest() {
    if (activeController) {
        try {
            activeController.abort();
        } catch {
            // ignore
        }
        activeController = null;
    }
}

function normalizeBaseUrl(value) {
    let url = String(value || '').trim() || 'http://127.0.0.1:8774';
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/forward$/i, '');
    url = url.replace(/\/voices$/i, '');
    return url;
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value);
        }
    }
    return '';
}

function unwrapVoiceList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    for (const key of ['voices', 'data', 'list', 'items', 'result']) {
        if (Array.isArray(payload[key])) return payload[key];
    }

    return Object.entries(payload).map(([id, value]) => {
        if (value && typeof value === 'object') return { id, ...value };
        return { id, name: String(value) };
    });
}

function normalizeVoice(raw, index) {
    if (typeof raw === 'string' || typeof raw === 'number') {
        const value = String(raw);
        return { name: value, voice_id: value, lang: 'zh-CN' };
    }

    if (!raw || typeof raw !== 'object') return null;

    const id = firstNonEmpty(
        raw.id,
        raw.voice_id,
        raw.voiceId,
        raw.voice,
        raw.value,
        raw.key,
        raw.name,
        raw.label,
        index,
    );

    const name = firstNonEmpty(
        raw.name,
        raw.label,
        raw.display_name,
        raw.displayName,
        raw.title,
        raw.voice,
        id,
    );

    const lang = firstNonEmpty(raw.lang, raw.language, raw.locale, 'zh-CN');

    if (!id) return null;
    return { name, voice_id: id, lang };
}

export class MultiTtsProvider {
    settings;
    voices = [];
    separator = '。';
    audioElement = document.createElement('audio');

    defaultSettings = {
        voiceMap: {},
        endpoint: 'http://127.0.0.1:8774',
        speed: 50,
        volume: 100,
        pitch: 50,
    };

    get settingsHtml() {
        return `
        <div class="multitts-settings">
            <label for="multitts_endpoint">MultiTTS 本地地址：</label>
            <input id="multitts_endpoint" type="text" class="text_pole" maxlength="300"
                   value="${this.defaultSettings.endpoint}" />
            <small>
                默认：<code>http://127.0.0.1:8774</code>。请先在 Android MultiTTS 中开启“转发服务”。<br>
                本扩展由当前浏览器直接访问手机本机，不经过 SillyTavern 服务器。
            </small>

            <label for="multitts_speed">语速：<span id="multitts_speed_value">50</span></label>
            <input id="multitts_speed" type="range" min="0" max="100" step="1" value="50" />

            <label for="multitts_volume">音量：<span id="multitts_volume_value">100</span></label>
            <input id="multitts_volume" type="range" min="0" max="100" step="1" value="100" />

            <label for="multitts_pitch">音高：<span id="multitts_pitch_value">50</span></label>
            <input id="multitts_pitch" type="range" min="0" max="100" step="1" value="50" />

            <div class="flex-container flexGap5" style="margin-top:8px">
                <button id="multitts_test_connection" type="button" class="menu_button">测试连接 / 刷新音色</button>
            </div>

            <small>
                如果浏览器首次询问“访问本地网络/本地设备”，请选择允许。<br>
                音色映射仍使用 SillyTavern 原生 Voice Map。
            </small>
        </div>`;
    }

    async loadSettings(settings) {
        this.settings = {
            ...this.defaultSettings,
            ...(settings || {}),
            voiceMap: { ...((settings && settings.voiceMap) || {}) },
        };
        this.settings.endpoint = normalizeBaseUrl(this.settings.endpoint);

        $('#multitts_endpoint').val(this.settings.endpoint);
        $('#multitts_speed').val(this.settings.speed);
        $('#multitts_volume').val(this.settings.volume);
        $('#multitts_pitch').val(this.settings.pitch);
        this.updateLabels();

        const bind = (selector) => {
            $(selector).off('.multitts').on('input.multitts change.multitts', () => this.onSettingsChange());
        };
        bind('#multitts_endpoint');
        bind('#multitts_speed');
        bind('#multitts_volume');
        bind('#multitts_pitch');

        $('#multitts_test_connection').off('.multitts').on('click.multitts', async () => {
            try {
                this.voices = await this.fetchTtsVoiceObjects();
                toastr.success(`已连接 MultiTTS，读取到 ${this.voices.length} 个音色。`, 'MultiTTS');
            } catch (error) {
                toastr.error(String(error?.message || error), 'MultiTTS 连接失败');
            }
        });

        await this.checkReady();
        console.info(`[MultiTTS] v${VERSION} settings loaded`);
    }

    updateLabels() {
        $('#multitts_speed_value').text(this.settings.speed);
        $('#multitts_volume_value').text(this.settings.volume);
        $('#multitts_pitch_value').text(this.settings.pitch);
    }

    onSettingsChange() {
        this.settings.endpoint = normalizeBaseUrl($('#multitts_endpoint').val());
        this.settings.speed = Math.max(0, Math.min(100, Number($('#multitts_speed').val()) || 0));
        this.settings.volume = Math.max(0, Math.min(100, Number($('#multitts_volume').val()) || 0));
        this.settings.pitch = Math.max(0, Math.min(100, Number($('#multitts_pitch').val()) || 0));
        this.updateLabels();
        saveTtsProviderSettings();
    }

    async checkReady() {
        try {
            this.voices = await this.fetchTtsVoiceObjects();
        } catch (error) {
            this.voices = [];
            console.warn('[MultiTTS] initial connection check failed:', error);
        }
    }

    async onRefreshClick() {
        this.voices = await this.fetchTtsVoiceObjects();
    }

    dispose() {
        abortActiveRequest();
        try {
            this.audioElement.pause();
        } catch {
            // ignore
        }
    }

    async getVoice(voiceName) {
        if (!this.voices.length) {
            this.voices = await this.fetchTtsVoiceObjects();
        }
        const wanted = String(voiceName);
        const match = this.voices.find(v => String(v.name) === wanted || String(v.voice_id) === wanted);
        if (!match) {
            throw new Error(`MultiTTS voice not found: ${voiceName}`);
        }
        return match;
    }

    async fetchTtsVoiceObjects() {
        const base = normalizeBaseUrl(this.settings?.endpoint || this.defaultSettings.endpoint);
        const response = await fetch(`${base}/voices`, {
            method: 'GET',
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error(`GET /voices failed: HTTP ${response.status} ${await response.text()}`);
        }

        const payload = await response.json();
        const list = unwrapVoiceList(payload)
            .map((voice, index) => normalizeVoice(voice, index))
            .filter(Boolean);

        if (!list.length) {
            throw new Error('MultiTTS /voices 返回成功，但没有识别到音色。请把 /voices 返回内容发给我适配。');
        }

        const seen = new Set();
        this.voices = list.filter(v => {
            const key = String(v.voice_id);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return this.voices;
    }

    async fetchTtsGeneration(text, voiceId, signal) {
        const base = normalizeBaseUrl(this.settings?.endpoint || this.defaultSettings.endpoint);
        const url = new URL(`${base}/forward`);
        url.searchParams.set('text', String(text ?? ''));
        url.searchParams.set('speed', String(this.settings.speed));
        url.searchParams.set('volume', String(this.settings.volume));
        url.searchParams.set('pitch', String(this.settings.pitch));
        if (voiceId !== undefined && voiceId !== null && String(voiceId) !== '') {
            url.searchParams.set('voice', String(voiceId));
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            cache: 'no-store',
            signal,
            headers: { 'Accept': 'audio/*,*/*;q=0.8' },
        });

        if (!response.ok) {
            throw new Error(`GET /forward failed: HTTP ${response.status} ${await response.text()}`);
        }

        return response;
    }

    async generateTts(text, voiceId) {
        abortActiveRequest();
        const controller = new AbortController();
        activeController = controller;
        try {
            return await this.fetchTtsGeneration(text, voiceId, controller.signal);
        } finally {
            if (activeController === controller) {
                activeController = null;
            }
        }
    }

    async previewTtsVoice(voiceId) {
        abortActiveRequest();
        const controller = new AbortController();
        activeController = controller;

        this.audioElement.pause();
        this.audioElement.currentTime = 0;

        try {
            const response = await this.fetchTtsGeneration(PREVIEW_TEXT, voiceId, controller.signal);
            const audio = await response.blob();
            const url = URL.createObjectURL(audio);
            this.audioElement.src = url;
            await this.audioElement.play();
            this.audioElement.onended = () => URL.revokeObjectURL(url);
        } finally {
            if (activeController === controller) {
                activeController = null;
            }
        }
    }
}

function ensureProviderOption() {
    const select = document.getElementById('tts_provider');
    if (!select) return;

    const matches = select.querySelectorAll(`option[value="${PROVIDER_NAME}"]`);
    if (!matches.length) {
        const option = document.createElement('option');
        option.value = PROVIDER_NAME;
        option.textContent = PROVIDER_NAME;
        select.appendChild(option);
    } else {
        for (let i = 1; i < matches.length; i++) matches[i].remove();
    }
}

function register() {
    ensureProviderOption();
    for (const ms of [0, 500, 1500, 3000]) setTimeout(ensureProviderOption, ms);

    if (registered) return;
    try {
        registerTtsProvider(PROVIDER_NAME, MultiTtsProvider);
        registered = true;
        console.info(`[MultiTTS] v${VERSION} provider registered`);
    } catch (error) {
        console.warn('[MultiTTS] provider registration failed (possibly already registered):', error);
    }
}

export function init() {
    register();
}

try {
    if (eventSource && event_types?.APP_READY) {
        eventSource.on(event_types.APP_READY, ensureProviderOption);
    }
} catch {
    // ignore
}

register();
