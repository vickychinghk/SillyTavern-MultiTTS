/**
 * MultiTTS provider for SillyTavern.
 *
 * Android MultiTTS local forwarder:
 *   GET http://127.0.0.1:8774/voices
 *   GET http://127.0.0.1:8774/forward?text=...&speed=...&volume=...&pitch=...&voice=...
 *
 * v1.1 strategy:
 * - Audio generation returns the direct /forward URL string to SillyTavern.
 *   SillyTavern's native TTS player accepts URL strings, avoiding fetch/CORS for audio.
 * - /voices parsing supports MultiTTS's real { success, data: { catalog } } format.
 * - If /voices cannot be read from JavaScript (e.g. CORS), a built-in default voice
 *   remains available. It omits the voice= parameter and uses MultiTTS's current narrator.
 */

import { eventSource, event_types } from '../../../../script.js';
import { registerTtsProvider, saveTtsProviderSettings } from '../../tts/index.js';

const PROVIDER_NAME = 'MultiTTS';
const VERSION = '1.1.0';
const DEFAULT_VOICE_ID = '__multitts_default__';
const DEFAULT_VOICE_NAME = 'MultiTTS 默认声音（使用 APP 当前旁白）';
const PREVIEW_TEXT = '你好，这是一段 MultiTTS 语音试听。';

let registered = false;

function normalizeBaseUrl(value) {
    let url = String(value || '').trim() || 'http://127.0.0.1:8774';
    url = url.replace(/\/+$/, '');
    url = url.replace(/\/(forward|voices)$/i, '');
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

function defaultVoice() {
    return {
        name: DEFAULT_VOICE_NAME,
        voice_id: DEFAULT_VOICE_ID,
        lang: 'zh-CN',
    };
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

    const lang = firstNonEmpty(raw.locale, raw.lang, raw.language, 'zh-CN');
    if (!id) return null;

    return {
        name,
        voice_id: id,
        lang,
    };
}

function extractMultiTtsVoices(payload) {
    if (!payload) return [];

    // Real MultiTTS shape used by existing integrations:
    // { success: true, data: { catalog: { groupA:[...], groupB:[...] } } }
    const catalog = payload?.data?.catalog;
    if (catalog && typeof catalog === 'object') {
        return Object.values(catalog)
            .flatMap(group => Array.isArray(group) ? group : [])
            .map((voice, index) => normalizeVoice(voice, index))
            .filter(Boolean);
    }

    // Other common shapes, retained for compatibility.
    if (Array.isArray(payload)) {
        return payload.map((voice, index) => normalizeVoice(voice, index)).filter(Boolean);
    }

    for (const key of ['voices', 'data', 'list', 'items', 'result']) {
        if (Array.isArray(payload?.[key])) {
            return payload[key].map((voice, index) => normalizeVoice(voice, index)).filter(Boolean);
        }
    }

    return [];
}

function dedupeVoices(voices) {
    const seen = new Set();
    return voices.filter(voice => {
        const id = String(voice.voice_id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function buildForwardUrl(base, text, voiceId, settings) {
    const url = new URL(`${normalizeBaseUrl(base)}/forward`);
    url.searchParams.set('text', String(text ?? ''));
    url.searchParams.set('speed', String(settings.speed));
    url.searchParams.set('volume', String(settings.volume));
    url.searchParams.set('pitch', String(settings.pitch));

    // Omitting voice= tells MultiTTS to use the current narrator/default voice.
    if (
        voiceId !== undefined &&
        voiceId !== null &&
        String(voiceId) !== '' &&
        String(voiceId) !== DEFAULT_VOICE_ID
    ) {
        url.searchParams.set('voice', String(voiceId));
    }

    return url.toString();
}

export class MultiTtsProvider {
    settings;
    voices = [defaultVoice()];
    separator = '。';
    audioElement = document.createElement('audio');
    lastVoiceLoadError = '';

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
                默认 <code>http://127.0.0.1:8774</code>。先在 Android MultiTTS 开启“转发服务”。<br>
                实际语音播放直接把 <code>/forward?... </code> 交给浏览器音频播放器，不需要 JS 读取音频响应。
            </small>

            <label for="multitts_speed">语速：<span id="multitts_speed_value">50</span></label>
            <input id="multitts_speed" type="range" min="0" max="100" step="1" value="50" />

            <label for="multitts_volume">音量：<span id="multitts_volume_value">100</span></label>
            <input id="multitts_volume" type="range" min="0" max="100" step="1" value="100" />

            <label for="multitts_pitch">音高：<span id="multitts_pitch_value">50</span></label>
            <input id="multitts_pitch" type="range" min="0" max="100" step="1" value="50" />

            <div class="flex-container flexGap5" style="margin-top:8px; flex-wrap:wrap">
                <button id="multitts_test_audio" type="button" class="menu_button">测试默认声音</button>
                <button id="multitts_refresh_voices" type="button" class="menu_button">尝试读取音色列表</button>
            </div>

            <div id="multitts_status" style="margin-top:6px"></div>

            <small>
                如果“读取音色列表”失败，但“测试默认声音”能播放，说明只是 <code>/voices</code> 被浏览器跨域策略挡住；<br>
                这不影响使用“MultiTTS 默认声音（使用 APP 当前旁白）”。角色映射可先全部选这个默认声音。
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

        $('#multitts_test_audio').off('.multitts').on('click.multitts', async () => {
            try {
                const url = buildForwardUrl(
                    this.settings.endpoint,
                    PREVIEW_TEXT,
                    DEFAULT_VOICE_ID,
                    this.settings,
                );
                this.audioElement.pause();
                this.audioElement.currentTime = 0;
                this.audioElement.src = url;
                await this.audioElement.play();
                this.setStatus('默认声音测试已开始播放。若能听到声音，主朗读链路就是通的。', true);
            } catch (error) {
                this.setStatus(`默认声音测试失败：${String(error?.message || error)}`, false);
            }
        });

        $('#multitts_refresh_voices').off('.multitts').on('click.multitts', async () => {
            const voices = await this.fetchTtsVoiceObjects(true);
            if (this.lastVoiceLoadError) {
                this.setStatus(
                    `无法从网页脚本读取 /voices，已保留默认声音。原因：${this.lastVoiceLoadError}`,
                    false,
                );
            } else {
                this.setStatus(`已读取 ${voices.length - 1} 个 MultiTTS 音色（另含 1 个默认声音）。`, true);
            }
        });

        await this.checkReady();
        console.info(`[MultiTTS] v${VERSION} settings loaded`);
    }

    setStatus(message, ok) {
        const el = $('#multitts_status');
        if (!el.length) return;
        el.text(message);
        el.css('opacity', '0.9');
        el.css('font-size', '0.9em');
        el.css('color', ok ? '' : 'var(--warning-color, #d9a441)');
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
        // Never fail provider initialization just because /voices cannot be fetched.
        this.voices = await this.fetchTtsVoiceObjects(false);
    }

    async onRefreshClick() {
        this.voices = await this.fetchTtsVoiceObjects(true);
    }

    dispose() {
        try {
            this.audioElement.pause();
        } catch {
            // ignore
        }
    }

    async getVoice(voiceName) {
        if (!this.voices.length) {
            this.voices = [defaultVoice()];
        }

        const wanted = String(voiceName);
        let match = this.voices.find(
            voice => String(voice.name) === wanted || String(voice.voice_id) === wanted,
        );

        // Preserve old mappings gracefully if /voices is no longer readable.
        if (!match && wanted) {
            match = { name: wanted, voice_id: wanted, lang: 'zh-CN' };
        }

        return match || defaultVoice();
    }

    async fetchTtsVoiceObjects(showLog = false) {
        const fallback = defaultVoice();
        const base = normalizeBaseUrl(this.settings?.endpoint || this.defaultSettings.endpoint);

        try {
            const response = await fetch(`${base}/voices`, {
                method: 'GET',
                cache: 'no-store',
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            let payload;
            try {
                payload = JSON.parse(text);
            } catch {
                throw new Error('返回内容不是 JSON');
            }

            const parsed = dedupeVoices(extractMultiTtsVoices(payload));

            if (!parsed.length) {
                throw new Error('返回 JSON 中没有识别到 data.catalog 音色');
            }

            this.lastVoiceLoadError = '';
            this.voices = [fallback, ...parsed];
            if (showLog) {
                console.info(`[MultiTTS] loaded ${parsed.length} voices from /voices`);
            }
            return this.voices;
        } catch (error) {
            this.lastVoiceLoadError = String(error?.message || error);
            console.warn(
                '[MultiTTS] /voices could not be read by page JavaScript. Falling back to app default voice:',
                error,
            );
            this.voices = [fallback];
            return this.voices;
        }
    }

    async generateTts(text, voiceId) {
        // SillyTavern accepts a URL string and assigns it directly to its <audio> element.
        // This avoids fetch()/CORS entirely for actual TTS audio.
        return buildForwardUrl(
            this.settings.endpoint,
            text,
            voiceId,
            this.settings,
        );
    }

    async previewTtsVoice(voiceId) {
        const url = buildForwardUrl(
            this.settings.endpoint,
            PREVIEW_TEXT,
            voiceId,
            this.settings,
        );

        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.audioElement.src = url;
        await this.audioElement.play();
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
        for (let i = 1; i < matches.length; i++) {
            matches[i].remove();
        }
    }
}

function register() {
    ensureProviderOption();
    for (const ms of [0, 500, 1500, 3000]) {
        setTimeout(ensureProviderOption, ms);
    }

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
