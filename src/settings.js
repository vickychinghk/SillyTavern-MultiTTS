export const SETTINGS_KEY = 'multiTtsNarrator';
export const SETTINGS_VERSION = 3;
export const CHECKPOINT_KEY = 'st-multitts-narrator:checkpoint:v1';

export const DEFAULT_SETTINGS = Object.freeze({
    version: SETTINGS_VERSION,
    enabled: false,
    autoNarrate: true,
    endpoint: 'http://127.0.0.1:8774',
    sendProsodyParams: true,
    skipCodeBlocks: false,
    skipTagBlocks: false,
    speed: 50,
    volume: 100,
    pitch: 50,
    segmentChars: 70,
    lookAhead: 3,
    maxInFlight: 3,
    retryCount: 1,
    debug: false,
});

const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export function normalizeSettings(raw = {}) {
    return {
        version: SETTINGS_VERSION,
        enabled: Boolean(raw.enabled ?? DEFAULT_SETTINGS.enabled),
        autoNarrate: Boolean(raw.autoNarrate ?? DEFAULT_SETTINGS.autoNarrate),
        endpoint: String(raw.endpoint || DEFAULT_SETTINGS.endpoint).trim(),
        sendProsodyParams: Boolean(raw.sendProsodyParams ?? DEFAULT_SETTINGS.sendProsodyParams),
        skipCodeBlocks: Boolean(raw.skipCodeBlocks ?? DEFAULT_SETTINGS.skipCodeBlocks),
        skipTagBlocks: Boolean(raw.skipTagBlocks ?? DEFAULT_SETTINGS.skipTagBlocks),
        speed: clamp(raw.speed, 0, 100, DEFAULT_SETTINGS.speed),
        volume: clamp(raw.volume, 0, 100, DEFAULT_SETTINGS.volume),
        pitch: clamp(raw.pitch, 0, 100, DEFAULT_SETTINGS.pitch),
        segmentChars: Math.round(clamp(raw.segmentChars, 20, 1000, DEFAULT_SETTINGS.segmentChars)),
        lookAhead: Math.round(clamp(raw.lookAhead, 1, 5, DEFAULT_SETTINGS.lookAhead)),
        maxInFlight: Math.round(clamp(raw.maxInFlight, 1, 5, DEFAULT_SETTINGS.maxInFlight)),
        retryCount: Math.round(clamp(raw.retryCount, 0, 1, DEFAULT_SETTINGS.retryCount)),
        debug: Boolean(raw.debug ?? DEFAULT_SETTINGS.debug),
    };
}

export function migrateSettings(raw = {}) {
    return normalizeSettings(raw);
}

export function settingsFingerprintInput(settings) {
    const s = normalizeSettings(settings);
    const fingerprint = {
        endpoint: s.endpoint,
        sendProsodyParams: s.sendProsodyParams,
        skipCodeBlocks: s.skipCodeBlocks,
        skipTagBlocks: s.skipTagBlocks,
        segmentChars: s.segmentChars,
        lookAhead: s.lookAhead,
        maxInFlight: s.maxInFlight,
    };
    if (s.sendProsodyParams) {
        fingerprint.speed = s.speed;
        fingerprint.volume = s.volume;
        fingerprint.pitch = s.pitch;
    }
    return JSON.stringify(fingerprint);
}

export class SettingsStore {
    constructor(host) {
        this.host = host;
        this.settings = normalizeSettings();
        this.listeners = new Set();
    }

    load() {
        const root = this.host.getExtensionSettings();
        this.settings = migrateSettings(root?.[SETTINGS_KEY]);
        root[SETTINGS_KEY] = { ...this.settings };
        return this.settings;
    }

    get() {
        return { ...this.settings };
    }

    update(patch) {
        this.settings = normalizeSettings({ ...this.settings, ...patch });
        const root = this.host.getExtensionSettings();
        root[SETTINGS_KEY] = { ...this.settings };
        this.host.saveSettingsDebounced();
        for (const listener of this.listeners) listener(this.get());
        return this.get();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}


export const DIAGNOSTICS_KEY = 'st-multitts-narrator:diagnostics:v1';
const MAX_DIAGNOSTIC_EVENTS = 2000;

// Bounded, durable, text-free event journal. Storage failure never blocks playback.
export class DiagnosticsStore {
    constructor(storage = globalThis.localStorage) {
        this.storage = storage;
        this.flushTimer = null;
        this.onPageHide = () => this.persist();
        globalThis.window?.addEventListener?.('pagehide', this.onPageHide);
        try {
            const saved = JSON.parse(storage?.getItem(DIAGNOSTICS_KEY) || '[]');
            this.events = Array.isArray(saved) ? saved.slice(-MAX_DIAGNOSTIC_EVENTS) : [];
        } catch {
            this.events = [];
        }
    }

    append(entry) {
        this.events.push(entry);
        if (this.events.length > MAX_DIAGNOSTIC_EVENTS) this.events.shift();
        // Avoid synchronous localStorage serialization on the critical audio handoff.
        if (this.flushTimer === null) this.flushTimer = setTimeout(() => this.persist(), 500);
    }

    read() {
        return this.events.slice();
    }

    clear() {
        if (this.flushTimer !== null) clearTimeout(this.flushTimer);
        this.flushTimer = null;
        this.events = [];
        try { this.storage?.removeItem(DIAGNOSTICS_KEY); } catch {}
    }

    persist() {
        if (this.flushTimer !== null) clearTimeout(this.flushTimer);
        this.flushTimer = null;
        try {
            this.storage?.setItem(DIAGNOSTICS_KEY, JSON.stringify(this.events));
        } catch {
            // Under quota pressure retain the newest half, without throwing.
            this.events = this.events.slice(-Math.floor(MAX_DIAGNOSTIC_EVENTS / 2));
            try { this.storage?.setItem(DIAGNOSTICS_KEY, JSON.stringify(this.events)); } catch {}
        }
    }

    dispose() {
        this.persist();
        globalThis.window?.removeEventListener?.('pagehide', this.onPageHide);
    }
}

export class CheckpointStore {
    constructor(storage = globalThis.localStorage) {
        this.storage = storage;
    }

    read() {
        try {
            const value = this.storage?.getItem(CHECKPOINT_KEY);
            return value ? JSON.parse(value) : null;
        } catch {
            return null;
        }
    }

    write(checkpoint) {
        try {
            this.storage?.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
        } catch {}
    }

    clear() {
        try {
            this.storage?.removeItem(CHECKPOINT_KEY);
        } catch {}
    }
}
