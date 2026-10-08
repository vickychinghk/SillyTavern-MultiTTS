import { prepareNarrationText, segmentNarrationText, sha256Hex } from './text.js';
import { settingsFingerprintInput } from './settings.js';
import { normalizeEndpoint, updateMediaSessionState } from './media.js';

const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CIRCUIT_WINDOW_MS = 30_000;
const HEALTH_TIMEOUT_MS = 20_000;

function makeId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isActiveStatus(status) {
    return ['preparing', 'buffering', 'playing', 'paused', 'action-required'].includes(status);
}

export class NarratorController {
    constructor({ host, settingsStore, checkpointStore, mediaFactory, diagnosticsStore = null, now = () => Date.now(), idFactory = makeId }) {
        this.host = host;
        this.settingsStore = settingsStore;
        this.checkpointStore = checkpointStore;
        this.mediaFactory = mediaFactory;
        this.now = now;
        this.idFactory = idFactory;
        this.status = 'idle';
        this.reason = null;
        this.session = null;
        this.pendingAuto = null;
        this.lastCompletedKey = null;
        this.listeners = new Set();
        this.diagnosticsStore = diagnosticsStore;
        this.diagnostics = diagnosticsStore?.read() ?? [];
        this.healthBusy = false;
        this.disposed = false;
        this.settingsUnsubscribe = this.settingsStore.subscribe(settings => {
            if (!settings.enabled && this.session) this.stop();
            this.emit();
        });
        this.record('app-opened');
    }

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }

    getSnapshot() {
        const settings = this.settingsStore.get();
        const current = this.session?.segments?.[this.session.currentIndex];
        return {
            status: this.status,
            reason: this.reason,
            enabled: settings.enabled,
            autoNarrate: settings.autoNarrate,
            hasSession: Boolean(this.session),
            pendingAuto: Boolean(this.pendingAuto),
            current: this.session ? Math.min(this.session.currentIndex + 1, this.session.segments.length) : 0,
            total: this.session?.segments.length ?? 0,
            currentSegmentState: current?.state ?? null,
            healthBusy: this.healthBusy,
            canPause: this.status === 'playing',
            canResume: ['paused', 'action-required'].includes(this.status),
            canStop: Boolean(this.session),
            canPrevious: Boolean(this.session && this.session.currentIndex > 0),
            canNext: Boolean(this.session && this.session.currentIndex < this.session.segments.length - 1),
            canSkip: Boolean(this.session && ['playing', 'buffering', 'action-required', 'paused'].includes(this.status)),
            canRetry: this.status === 'action-required' && ['segment-error', 'playback-error', 'circuit-breaker'].includes(this.reason),
        };
    }

    emit() {
        updateMediaSessionState(this.status);
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) listener(snapshot);
    }

    record(event, data = {}) {
        const entry = { at: this.now(), event, ...data };
        this.diagnostics.push(entry);
        if (this.diagnostics.length > 2000) this.diagnostics.shift();
        this.diagnosticsStore?.append(entry);
        if (this.settingsStore.get().debug) console.debug('[MultiTTS Narrator]', entry);
    }

    clearDiagnostics() {
        this.diagnostics = [];
        this.diagnosticsStore?.clear();
    }

    async sourceFromCandidate(candidate) {
        if (!candidate?.text || candidate.chatId === undefined || candidate.index === undefined) return null;
        const text = prepareNarrationText(candidate.text, this.settingsStore.get());
        if (!text) {
            this.record('source-empty-after-filter', {
                messageIndex: Number(candidate.index),
                originalChars: Array.from(candidate.text).length,
            });
            return null;
        }
        const revisionHash = await sha256Hex(JSON.stringify({
            chatId: String(candidate.chatId),
            index: Number(candidate.index),
            name: String(candidate.name ?? ''),
            swipeId: candidate.swipeId ?? null,
            text,
        }));
        return {
            chatId: String(candidate.chatId),
            index: Number(candidate.index),
            name: String(candidate.name ?? ''),
            swipeId: candidate.swipeId ?? null,
            text,
            revisionHash,
            key: `${String(candidate.chatId)}:${Number(candidate.index)}:${revisionHash}`,
        };
    }

    async handleAssistantFinalized(candidate) {
        const settings = this.settingsStore.get();
        if (!settings.enabled || !settings.autoNarrate || !candidate) return false;
        return this.narrateCandidate(candidate, 'auto');
    }

    async narrateLatestManual() {
        return this.narrateManual(this.host.getLatestAssistantMessage());
    }

    async narrateMessage(index) {
        return this.narrateManual(this.host.getMessage(index));
    }

    async narrateManual(candidate) {
        if (!this.settingsStore.get().enabled) {
            this.status = 'action-required';
            this.reason = 'disabled';
            this.emit();
            return false;
        }
        if (!candidate) {
            this.status = 'action-required';
            this.reason = 'no-message';
            this.emit();
            return false;
        }
        return this.narrateCandidate(candidate, 'manual');
    }

    async narrateCandidate(candidate, sourceMode = 'manual') {
        const source = await this.sourceFromCandidate(candidate);
        if (!source) {
            if (sourceMode === 'manual') {
                this.status = 'action-required';
                this.reason = 'empty-text';
                this.emit();
            }
            return false;
        }

        if (sourceMode === 'auto') {
            if (this.session?.source.key === source.key || this.pendingAuto?.key === source.key || this.lastCompletedKey === source.key) return false;
            if (this.session && isActiveStatus(this.status)) {
                this.pendingAuto = source;
                this.record('pending-auto-replaced', { messageIndex: source.index });
                this.emit();
                return true;
            }
        } else {
            await this.stop({ clearPending: true, silent: true });
        }

        return this.startSource(source, sourceMode);
    }

    async startSource(source, sourceMode, restore = null) {
        if (this.disposed) return false;
        const settings = this.settingsStore.get();
        if (!settings.enabled) return false;

        const segments = segmentNarrationText(source.text, settings.segmentChars);
        if (!segments.length) { this.record('narration-empty', { messageIndex: source.index }); return false; }
        try { normalizeEndpoint(settings.endpoint); } catch {
            this.status = 'action-required';
            this.reason = 'endpoint';
            this.emit();
            return false;
        }
        const generation = (this.session?.generation ?? 0) + 1;
        const sessionId = this.idFactory();
        const currentIndex = restore?.segmentIndex ?? 0;

        const session = {
            id: sessionId,
            generation,
            sourceMode,
            source,
            settings: { ...settings },
            settingsHash: null,
            segments: segments.map((text, index) => ({
                index,
                text,
                length: Array.from(text).length,
                state: index < currentIndex ? 'ended' : 'queued',
                attempts: 0,
                slot: null,
                loadStartedAt: null,
                readyAt: null,
                playRequestedAt: null,
                playingAt: null,
                playedMs: 0,
                waitingAt: null,
                stalledMs: 0,
                lastProgressAt: null,
            })),
            currentIndex,
            currentTime: Number(restore?.currentTime) || 0,
            resumeTime: Number(restore?.currentTime) || 0,
            playRequestIndex: null,
            recentFailures: [],
            breakerOpen: false,
            lastSegmentEndedAt: null,
        };
        this.session = session;

        this.status = restore ? 'paused' : 'preparing';
        this.reason = restore ? 'restore' : null;
        this.record(restore ? 'session-restored' : 'session-started', {
            messageIndex: source.index,
            segmentCount: segments.length,
            textLength: Array.from(source.text).length,
            sourceMode,
        });
        this.emit();

        const settingsHash = await sha256Hex(settingsFingerprintInput(settings));
        if (this.session !== session || this.disposed) return false;
        session.settingsHash = settingsHash;
        this.writeCheckpoint();

        if (!restore) {
            this.fillWindow();
            this.tryPlay();
        }
        return true;
    }

    fillWindow() {
        const session = this.session;
        if (!session || this.disposed || session.breakerOpen || this.status === 'action-required') return;
        const inFlight = () => session.segments.filter(segment => segment.state === 'loading').length;
        const windowEnd = Math.min(session.segments.length, session.currentIndex + 1 + session.settings.lookAhead);

        for (let index = session.currentIndex; index < windowEnd && inFlight() < session.settings.maxInFlight; index++) {
            const segment = session.segments[index];
            if (segment.state === 'queued') this.loadSegment(session, segment);
        }
    }

    loadSegment(session, segment) {
        if (this.session !== session || segment.state !== 'queued') return;
        segment.attempts += 1;
        segment.state = 'loading';
        segment.loadStartedAt = this.now();
        const sessionId = session.id;
        const generation = session.generation;
        const slot = this.mediaFactory({
            index: segment.index,
            text: segment.text,
            settings: session.settings,
            onEvent: (type, mediaSlot, detail) => this.onSlotEvent(sessionId, generation, segment.index, type, mediaSlot, detail),
        });
        segment.slot = slot;
        this.record('segment-load', { index: segment.index, attempt: segment.attempts, length: segment.length, readyState: slot.getState?.().readyState ?? null });
        try {
            slot.load();
        } catch {
            this.onSlotEvent(sessionId, generation, segment.index, 'error', slot, { code: null });
        }
    }

    onSlotEvent(sessionId, generation, index, type, slot, detail = {}) {
        const session = this.session;
        if (!session || session.id !== sessionId || session.generation !== generation) return;
        const segment = session.segments[index];
        if (!segment || segment.slot !== slot) return;

        if (type === 'ready') {
            if (segment.state !== 'loading') return;
            segment.state = 'ready';
            segment.readyAt = this.now();
            this.record('segment-ready', {
                index,
                attempt: segment.attempts,
                loadMs: segment.loadStartedAt == null ? null : segment.readyAt - segment.loadStartedAt,
                media: slot.getState?.() ?? null,
            });
            this.fillWindow();
            this.tryPlay();
            return;
        }

        if (['waiting', 'stalled', 'progress', 'loadedmetadata', 'canplaythrough', 'seeking', 'seeked'].includes(type)) {
            const at = this.now();
            if (type === 'progress' && segment.lastProgressAt !== null && at - segment.lastProgressAt < 2000) return;
            if (type === 'progress') segment.lastProgressAt = at;
            if (['waiting', 'stalled'].includes(type)) {
                if (segment.playingAt !== null) {
                    segment.playedMs += at - segment.playingAt;
                    segment.playingAt = null;
                }
                if (segment.waitingAt === null) segment.waitingAt = at;
            }
            this.record('media-' + type, { index, media: slot.getState?.() ?? null });
            if (['waiting', 'stalled'].includes(type) && index === session.currentIndex && this.status === 'playing') {
                this.status = 'buffering';
                this.emit();
            }
            return;
        }

        if (type === 'playing') {
            if (index !== session.currentIndex) return;
            const at = this.now();
            if (segment.waitingAt !== null) {
                segment.stalledMs += at - segment.waitingAt;
                segment.waitingAt = null;
            }
            const gapMs = session.lastSegmentEndedAt === null ? null : at - session.lastSegmentEndedAt;
            session.lastSegmentEndedAt = null; // Report the handoff once, not on subsequent rebuffer/resume.
            const startDelayMs = segment.playRequestedAt === null ? null : at - segment.playRequestedAt;
            if (segment.playingAt !== null) segment.playedMs += at - segment.playingAt;
            segment.playingAt = at;
            segment.state = 'playing';
            session.playRequestIndex = null;
            session.resumeTime = 0;
            this.status = 'playing';
            this.reason = null;
            this.record('segment-playing', {
                index, gapMs, startDelayMs, stalledMs: segment.stalledMs,
                readyToPlayingMs: segment.readyAt === null ? null : at - segment.readyAt,
                media: slot.getState?.() ?? null,
            });
            this.writeCheckpoint();
            this.emit();
            return;
        }

        if (type === 'ended') {
            if (index !== session.currentIndex) return;
            const wasPaused = this.status === 'paused';
            const at = this.now();
            const playbackMs = segment.playedMs + (segment.playingAt === null ? 0 : at - segment.playingAt);
            const media = slot.getState?.() ?? null;
            session.lastSegmentEndedAt = at;
            segment.state = 'ended';
            segment.slot?.dispose();
            segment.slot = null;
            session.playRequestIndex = null;
            session.currentIndex += 1;
            session.currentTime = 0;
            this.record('segment-ended', { index, playbackMs, stalledMs: segment.stalledMs, media });
            this.writeCheckpoint();
            if (session.currentIndex >= session.segments.length) {
                this.completeSession(session);
                return;
            }
            this.status = wasPaused ? 'paused' : 'buffering';
            this.fillWindow();
            if (!wasPaused) this.tryPlay();
            this.emit();
            return;
        }

        if (type === 'error') this.handleSegmentError(session, segment, detail);
    }

    handleSegmentError(session, segment, detail) {
        segment.slot?.dispose();
        segment.slot = null;
        session.playRequestIndex = null;
        this.record('segment-error', {
            index: segment.index, attempt: segment.attempts, mediaCode: detail?.code ?? null,
            playedMs: segment.playedMs, stalledMs: segment.stalledMs,
            elapsedMs: segment.loadStartedAt === null ? null : this.now() - segment.loadStartedAt,
        });

        if (segment.attempts <= session.settings.retryCount) {
            segment.state = 'queued';
            this.fillWindow();
            this.tryPlay();
            return;
        }

        segment.state = 'error';
        const now = this.now();
        session.recentFailures = session.recentFailures.filter(item => now - item.at <= CIRCUIT_WINDOW_MS);
        session.recentFailures.push({ index: segment.index, at: now });
        const distinctFailures = new Set(session.recentFailures.map(item => item.index)).size;
        session.breakerOpen = distinctFailures >= 2;
        if (segment.index === session.currentIndex) {
            this.status = 'action-required';
            this.reason = session.breakerOpen ? 'circuit-breaker' : 'segment-error';
        } else if (session.breakerOpen) {
            this.reason = 'circuit-breaker';
        }
        this.writeCheckpoint();
        this.emit();
    }

    async tryPlay() {
        const session = this.session;
        if (!session || this.disposed || ['paused', 'action-required'].includes(this.status)) return;
        if (session.currentIndex >= session.segments.length) {
            this.completeSession(session);
            return;
        }
        const segment = session.segments[session.currentIndex];
        if (!segment) return;

        if (segment.state === 'ended' || segment.state === 'skipped' || segment.state === 'canceled') {
            session.currentIndex += 1;
            return this.tryPlay();
        }
        if (segment.state === 'error') {
            this.status = 'action-required';
            this.reason = session.breakerOpen ? 'circuit-breaker' : 'segment-error';
            this.emit();
            return;
        }
        if (segment.state === 'playing') return;
        if (segment.state !== 'ready') {
            this.status = this.status === 'preparing' ? 'preparing' : 'buffering';
            this.fillWindow();
            this.emit();
            return;
        }
        if (session.playRequestIndex === segment.index) return;

        session.playRequestIndex = segment.index;
        segment.playRequestedAt = this.now();
        this.record('segment-play-request', { index: segment.index, readyWaitMs: segment.readyAt === null ? null : segment.playRequestedAt - segment.readyAt });
        if (session.resumeTime > 0) segment.slot?.seek(session.resumeTime);
        try {
            await segment.slot.play();
            if (this.session !== session || session.currentIndex !== segment.index) return;
            if (segment.state === 'ready') {
                // Some browsers resolve play() before dispatching "playing".
                this.onSlotEvent(session.id, session.generation, segment.index, 'playing', segment.slot);
            }
        } catch (error) {
            if (this.session !== session) return;
            session.playRequestIndex = null;
            this.status = 'action-required';
            this.reason = error?.name === 'NotAllowedError' ? 'autoplay' : 'playback-error';
            this.record('play-rejected', { index: segment.index, category: this.reason, delayMs: this.now() - segment.playRequestedAt });
            this.writeCheckpoint();
            this.emit();
        }
    }

    pause() {
        const session = this.session;
        if (!session || this.status !== 'playing') return false;
        const segment = session.segments[session.currentIndex];
        if (!segment?.slot) return false;
        segment.slot.pause();
        if (segment.playingAt !== null) {
            segment.playedMs += this.now() - segment.playingAt;
            segment.playingAt = null;
        }
        session.currentTime = segment.slot.getCurrentTime();
        session.resumeTime = session.currentTime;
        this.status = 'paused';
        this.reason = null;
        this.record('paused', { index: session.currentIndex, currentTime: Math.round(session.currentTime * 10) / 10, playedMs: segment.playedMs });
        this.writeCheckpoint();
        this.emit();
        return true;
    }

    async resume() {
        const session = this.session;
        if (!session) return false;
        if (!['paused', 'action-required', 'buffering', 'preparing'].includes(this.status)) return false;
        if (this.reason === 'disabled' || this.reason === 'no-message') return false;

        session.breakerOpen = false;
        this.status = 'buffering';
        this.reason = null;
        this.record('resume-request', { index: session.currentIndex });
        const segment = session.segments[session.currentIndex];
        if (!segment) return false;

        if (segment.state === 'playing' && segment.slot) {
            segment.playRequestedAt = this.now();
            if (session.resumeTime > 0) segment.slot.seek(session.resumeTime);
            try {
                await segment.slot.play();
                this.status = 'playing';
                this.reason = null;
                session.resumeTime = 0;
                if (segment.playingAt === null) segment.playingAt = this.now();
                this.writeCheckpoint();
                this.emit();
                return true;
            } catch (error) {
                this.status = 'action-required';
                this.reason = error?.name === 'NotAllowedError' ? 'autoplay' : 'playback-error';
                this.emit();
                return false;
            }
        }

        if (segment.state === 'error') segment.state = 'queued';
        this.fillWindow();
        this.tryPlay();
        this.emit();
        return true;
    }

    async retry() {
        const session = this.session;
        if (!session || this.status !== 'action-required') return false;
        const segment = session.segments[session.currentIndex];
        if (!segment) return false;
        if (this.reason === 'autoplay') return this.resume();

        segment.slot?.dispose();
        segment.slot = null;
        segment.state = 'queued';
        segment.attempts = 0;
        session.breakerOpen = false;
        session.recentFailures = [];
        this.status = 'buffering';
        this.reason = null;
        this.record('manual-retry', { index: segment.index });
        this.fillWindow();
        this.tryPlay();
        this.emit();
        return true;
    }

    previous() {
        const session = this.session;
        if (!session || session.currentIndex <= 0) return false;

        const current = session.segments[session.currentIndex];
        if (current?.slot && current.state === 'playing') {
            current.slot.pause();
            current.slot.seek(0);
            current.state = 'ready';
        } else if (current?.state === 'loading') {
            current.slot?.dispose();
            current.slot = null;
            current.state = 'queued';
            current.attempts = 0;
            current.loadStartedAt = null;
            current.readyAt = null;
        } else if (current?.state === 'error') {
            current.slot?.dispose();
            current.slot = null;
            current.state = 'queued';
            current.attempts = 0;
        }

        const targetIndex = session.currentIndex - 1;
        const target = session.segments[targetIndex];
        target.slot?.dispose();
        target.slot = null;
        target.state = 'queued';
        target.attempts = 0;
        target.loadStartedAt = null;
        target.readyAt = null;

        session.currentIndex = targetIndex;
        session.currentTime = 0;
        session.resumeTime = 0;
        session.playRequestIndex = null;
        session.breakerOpen = false;
        session.recentFailures = [];
        this.status = 'buffering';
        this.reason = null;
        this.record('segment-previous', { index: targetIndex });
        session.lastSegmentEndedAt = null;
        this.writeCheckpoint();
        this.fillWindow();
        this.tryPlay();
        this.emit();
        return true;
    }

    next() {
        return this.skip();
    }

    skip() {
        const session = this.session;
        if (!session) return false;
        const segment = session.segments[session.currentIndex];
        if (!segment) return false;
        segment.slot?.pause();
        segment.slot?.dispose();
        segment.slot = null;
        segment.state = 'skipped';
        session.currentIndex += 1;
        session.currentTime = 0;
        session.resumeTime = 0;
        session.playRequestIndex = null;
        session.breakerOpen = false;
        session.recentFailures = [];
        this.record('segment-skipped', { index: segment.index });
        session.lastSegmentEndedAt = null;
        if (session.currentIndex >= session.segments.length) {
            this.completeSession(session);
            return true;
        }
        this.status = 'buffering';
        this.reason = null;
        this.writeCheckpoint();
        this.fillWindow();
        this.tryPlay();
        this.emit();
        return true;
    }

    async stop({ clearPending = true, silent = false } = {}) {
        const session = this.session;
        if (session) {
            session.generation += 1;
            for (const segment of session.segments) {
                segment.slot?.dispose();
                segment.slot = null;
                if (!['ended', 'skipped'].includes(segment.state)) segment.state = 'canceled';
            }
            this.record('session-stopped', { messageIndex: session.source.index });
        }
        this.session = null;
        if (clearPending) this.pendingAuto = null;
        this.status = 'idle';
        this.reason = null;
        this.checkpointStore.clear();
        if (!silent) this.emit();
        return true;
    }

    async completeSession(session) {
        if (this.session !== session) return;
        for (const segment of session.segments) {
            segment.slot?.dispose();
            segment.slot = null;
        }
        this.lastCompletedKey = session.source.key;
        this.record('session-completed', { messageIndex: session.source.index, segmentCount: session.segments.length });
        this.session = null;
        this.status = 'completed';
        this.reason = null;
        this.checkpointStore.clear();
        this.emit();

        if (this.pendingAuto) {
            const next = this.pendingAuto;
            this.pendingAuto = null;
            await this.startSource(next, 'auto');
        }
    }

    async handleHostMutation(kind) {
        if (!this.session) return;
        if (kind === 'deleted') {
            await this.stop({ clearPending: true });
            return;
        }
        await this.reconcileActiveSource();
    }

    async handleChatChanged() {
        this.pendingAuto = null;
        await this.stop({ clearPending: true });
    }

    async reconcileActiveSource() {
        const session = this.session;
        if (!session) return false;
        if (this.host.getChatId() !== session.source.chatId) {
            await this.stop({ clearPending: true });
            return false;
        }
        const candidate = this.host.getMessage(session.source.index);
        if (!candidate) {
            await this.stop({ clearPending: false });
            return false;
        }
        const source = await this.sourceFromCandidate(candidate);
        if (!source || source.revisionHash === session.source.revisionHash) return true;

        const mode = session.sourceMode;
        this.record('source-replaced', { messageIndex: session.source.index });
        await this.stop({ clearPending: false, silent: true });
        return this.startSource(source, mode);
    }

    writeCheckpoint() {
        const session = this.session;
        if (!session || !session.settingsHash) return;
        const segment = session.segments[session.currentIndex];
        const currentTime = segment?.slot?.getCurrentTime?.() ?? session.currentTime ?? 0;
        this.checkpointStore.write({
            version: 1,
            chatId: session.source.chatId,
            messageIndex: session.source.index,
            revisionHash: session.source.revisionHash,
            segmentIndex: session.currentIndex,
            currentTime: Math.max(0, Number(currentTime) || 0),
            settingsHash: session.settingsHash,
            status: this.status,
            timestamp: this.now(),
        });
    }

    async tryRestoreCheckpoint() {
        const settings = this.settingsStore.get();
        if (!settings.enabled || this.session) return false;
        const checkpoint = this.checkpointStore.read();
        if (!checkpoint || checkpoint.version !== 1) return false;
        if (this.now() - Number(checkpoint.timestamp || 0) > CHECKPOINT_MAX_AGE_MS) {
            this.checkpointStore.clear();
            return false;
        }
        if (String(checkpoint.chatId) !== this.host.getChatId()) {
            this.checkpointStore.clear();
            return false;
        }
        const candidate = this.host.getMessage(checkpoint.messageIndex);
        const source = await this.sourceFromCandidate(candidate);
        if (!source || source.revisionHash !== checkpoint.revisionHash) {
            this.checkpointStore.clear();
            return false;
        }
        const settingsHash = await sha256Hex(settingsFingerprintInput(settings));
        if (settingsHash !== checkpoint.settingsHash) {
            this.checkpointStore.clear();
            return false;
        }
        const segments = segmentNarrationText(source.text, settings.segmentChars);
        if (checkpoint.segmentIndex < 0 || checkpoint.segmentIndex >= segments.length) {
            this.checkpointStore.clear();
            return false;
        }
        return this.startSource(source, 'manual', {
            segmentIndex: checkpoint.segmentIndex,
            currentTime: checkpoint.currentTime,
        });
    }

    onVisibilityChange(state) {
        if (state === 'hidden') {
            this.writeCheckpoint();
            this.record('page-hidden');
            return;
        }
        if (state === 'visible') {
            this.record('page-visible');
            this.reconcileActiveSource();
            const session = this.session;
            const segment = session?.segments?.[session.currentIndex];
            const mediaState = segment?.slot?.getState?.();
            if (session && this.status === 'playing' && mediaState?.ended) {
                this.onSlotEvent(session.id, session.generation, session.currentIndex, 'ended', segment.slot);
                return;
            }
            if (session && this.status === 'playing' && mediaState?.paused) {
                session.currentTime = mediaState.currentTime || 0;
                session.resumeTime = session.currentTime;
                this.status = 'paused';
                this.reason = 'background-paused';
                this.writeCheckpoint();
                this.emit();
                return;
            }
            if (session && !['paused', 'action-required'].includes(this.status)) {
                this.fillWindow();
                this.tryPlay();
            }
        }
    }

    async runHealthCheck() {
        if (this.healthBusy) return false;
        this.healthBusy = true;
        this.emit();
        const settings = this.settingsStore.get();
        let slot;
        let timer;
        try {
            normalizeEndpoint(settings.endpoint);
            const result = await new Promise((resolve, reject) => {
                const finish = (ok, error) => {
                    clearTimeout(timer);
                    ok ? resolve(true) : reject(error || new Error('Health check failed.'));
                };
                slot = this.mediaFactory({
                    index: -1,
                    text: '这是 MultiTTS Narrator 健康检查。',
                    settings,
                    onEvent: type => {
                        if (type === 'playing') finish(true);
                        else if (type === 'error') finish(false, new Error('Media error.'));
                    },
                });
                timer = setTimeout(() => finish(false, new Error('Health check timed out.')), HEALTH_TIMEOUT_MS);
                slot.load();
                slot.play().catch(error => finish(false, error));
            });
            this.record('health-ok');
            return result;
        } catch {
            this.record('health-failed');
            return false;
        } finally {
            clearTimeout(timer);
            slot?.dispose();
            this.healthBusy = false;
            this.emit();
        }
    }

    getDiagnosticsReport() {
        const settings = this.settingsStore.get();
        let endpoint = 'invalid';
        try { endpoint = normalizeEndpoint(settings.endpoint); } catch {}
        return JSON.stringify({
            product: 'MultiTTS Narrator',
            version: '2.0.0-alpha.4',
            generatedAt: new Date(this.now()).toISOString(),
            state: this.getSnapshot(),
            settings: {
                endpoint,
                sendProsodyParams: settings.sendProsodyParams,
                skipCodeBlocks: settings.skipCodeBlocks,
                skipTagBlocks: settings.skipTagBlocks,
                speed: settings.speed,
                volume: settings.volume,
                pitch: settings.pitch,
                segmentChars: settings.segmentChars,
                lookAhead: settings.lookAhead,
                maxInFlight: settings.maxInFlight,
                retryCount: settings.retryCount,
            },
            events: this.diagnosticsStore?.read() ?? this.diagnostics,
        }, null, 2);
    }

    async dispose() {
        if (this.disposed) return;
        await this.stop({ clearPending: true, silent: true });
        this.disposed = true;
        this.settingsUnsubscribe?.();
        this.diagnosticsStore?.dispose();
        this.listeners.clear();
    }
}
