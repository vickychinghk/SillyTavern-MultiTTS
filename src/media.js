export function normalizeEndpoint(input) {
    const raw = String(input || '').trim();
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Endpoint must use http or https.');
    if (url.username || url.password) throw new Error('Endpoint credentials are not allowed.');
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/(voices|forward)\/?$/i, '').replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
}

export function isLoopbackEndpoint(input) {
    try {
        const { hostname } = new URL(normalizeEndpoint(input));
        return hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname);
    } catch {
        return false;
    }
}

export function buildForwardUrl(endpoint, text, settings) {
    const url = new URL(`${normalizeEndpoint(endpoint)}/forward`);
    url.searchParams.set('text', String(text ?? ''));
    if (settings.sendProsodyParams !== false) {
        url.searchParams.set('speed', String(settings.speed));
        url.searchParams.set('volume', String(settings.volume));
        url.searchParams.set('pitch', String(settings.pitch));
    }
    return url.toString();
}

export class AudioSlot {
    constructor({ index, text, settings, onEvent, audioFactory = () => document.createElement('audio') }) {
        this.index = index;
        this.text = text;
        this.settings = settings;
        this.onEvent = onEvent;
        this.audio = audioFactory();
        this.disposed = false;
        this.ready = false;
        this.loadStartedAt = 0;
        this.handlers = {
            canplay: () => {
                if (this.disposed || this.ready) return;
                this.ready = true;
                this.onEvent?.('ready', this);
            },
            playing: () => this.disposed || this.onEvent?.('playing', this),
            ended: () => this.disposed || this.onEvent?.('ended', this),
            waiting: () => this.disposed || this.onEvent?.('waiting', this),
            stalled: () => this.disposed || this.onEvent?.('stalled', this),
            progress: () => this.disposed || this.onEvent?.('progress', this),
            loadedmetadata: () => this.disposed || this.onEvent?.('loadedmetadata', this),
            canplaythrough: () => this.disposed || this.onEvent?.('canplaythrough', this),
            seeking: () => this.disposed || this.onEvent?.('seeking', this),
            seeked: () => this.disposed || this.onEvent?.('seeked', this),
            error: () => this.disposed || this.onEvent?.('error', this, { code: this.audio.error?.code ?? null }),
        };
        this.audio.preload = 'auto';
        this.audio.removeAttribute?.('crossorigin');
        this.audio.setAttribute?.('playsinline', '');
        for (const [name, handler] of Object.entries(this.handlers)) this.audio.addEventListener(name, handler);
    }

    load() {
        if (this.disposed) return;
        this.loadStartedAt = performance.now?.() ?? Date.now();
        this.audio.src = buildForwardUrl(this.settings.endpoint, this.text, this.settings);
        this.onEvent?.('loading', this);
        this.audio.load();
    }

    async play() {
        if (this.disposed) throw new Error('Media slot disposed.');
        return this.audio.play();
    }

    pause() {
        if (!this.disposed) this.audio.pause();
    }

    seek(seconds) {
        if (this.disposed || !Number.isFinite(seconds) || seconds < 0) return;
        try { this.audio.currentTime = seconds; } catch {}
    }

    getCurrentTime() {
        return Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0;
    }

    getState() {
        const currentTime = this.getCurrentTime();
        let bufferedAhead = null;
        try {
            const ranges = this.audio.buffered;
            for (let index = 0; index < ranges.length; index++) {
                if (ranges.start(index) <= currentTime && ranges.end(index) >= currentTime) {
                    bufferedAhead = Math.round((ranges.end(index) - currentTime) * 1000);
                    break;
                }
            }
        } catch {}
        return {
            paused: Boolean(this.audio.paused),
            ended: Boolean(this.audio.ended),
            readyState: Number(this.audio.readyState || 0),
            networkState: Number(this.audio.networkState || 0),
            currentTime,
            duration: Number.isFinite(this.audio.duration) ? this.audio.duration : null,
            bufferedAheadMs: bufferedAhead,
        };
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        try { this.audio.pause(); } catch {}
        for (const [name, handler] of Object.entries(this.handlers)) this.audio.removeEventListener(name, handler);
        try {
            this.audio.removeAttribute('src');
            this.audio.load();
        } catch {}
        this.onEvent = null;
    }
}

export function createAudioSlotFactory(audioFactory) {
    return options => new AudioSlot({ ...options, audioFactory: audioFactory || undefined });
}

export function installMediaSession(controller, mediaSession = globalThis.navigator?.mediaSession) {
    if (!mediaSession?.setActionHandler) return () => {};
    try {
        if (globalThis.MediaMetadata) mediaSession.metadata = new MediaMetadata({ title: 'MultiTTS 旁白', artist: 'SillyTavern' });
    } catch {}
    const actions = {
        play: () => controller.resume(),
        pause: () => controller.pause(),
        stop: () => controller.stop(),
        previoustrack: () => controller.previous(),
        nexttrack: () => controller.next(),
    };
    for (const [action, handler] of Object.entries(actions)) {
        try { mediaSession.setActionHandler(action, handler); } catch {}
    }
    return () => {
        for (const action of Object.keys(actions)) {
            try { mediaSession.setActionHandler(action, null); } catch {}
        }
    };
}

export function updateMediaSessionState(status, mediaSession = globalThis.navigator?.mediaSession) {
    if (!mediaSession) return;
    try {
        mediaSession.playbackState = status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
    } catch {}
}
