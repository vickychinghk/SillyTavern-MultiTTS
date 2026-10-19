import test from 'node:test';
import assert from 'node:assert/strict';
import { NarratorController } from '../src/narrator.js';
import { SettingsStore } from '../src/settings.js';

class MemoryCheckpoint {
    value = null;
    read() { return this.value ? structuredClone(this.value) : null; }
    write(value) { this.value = structuredClone(value); }
    clear() { this.value = null; }
}

class FakeHost {
    constructor(text = '一二三四五六七八九十。一二三四五六七八九十。一二三四五六七八九十。') {
        this.root = {};
        this.chatId = 'chat-1';
        this.messages = [{ name: 'A', is_user: false, is_system: false, mes: text, swipe_id: 0 }];
    }
    getExtensionSettings() { return this.root; }
    saveSettingsDebounced() {}
    getChatId() { return this.chatId; }
    candidate(index = 0) {
        const m = this.messages[index];
        return m ? { chatId: this.chatId, index, name: m.name, swipeId: m.swipe_id, text: m.mes } : null;
    }
    getLatestAssistantMessage() { return this.candidate(this.messages.length - 1); }
    getMessage(index) { return this.candidate(index); }
}

class FakeSlot {
    constructor(options, registry) {
        this.options = options;
        this.index = options.index;
        this.registry = registry;
        this.currentTime = 0;
        this.disposed = false;
        registry.push(this);
    }
    load() {}
    async play() { this.options.onEvent('playing', this); }
    pause() {}
    seek(value) { this.currentTime = value; }
    getCurrentTime() { return this.currentTime; }
    getState() { return { paused: false, ended: false, currentTime: this.currentTime, readyState: 4 }; }
    dispose() { this.disposed = true; }
    emit(type, detail) { this.options.onEvent(type, this, detail); }
}

function makeController(text, overrides = {}) {
    const host = new FakeHost(text);
    const settingsStore = new SettingsStore(host);
    settingsStore.load();
    settingsStore.update({ enabled: true, autoNarrate: true, segmentChars: 20, lookAhead: 5, maxInFlight: 5, ...overrides });
    const checkpointStore = new MemoryCheckpoint();
    const slots = [];
    const controller = new NarratorController({
        host,
        settingsStore,
        checkpointStore,
        mediaFactory: options => new FakeSlot(options, slots),
        idFactory: (() => { let i = 0; return () => `s-${++i}`; })(),
        now: (() => { let t = 1000; return () => ++t; })(),
    });
    return { host, settingsStore, checkpointStore, slots, controller };
}

const byIndex = (slots, index) => [...slots].reverse().find(slot => slot.index === index && !slot.disposed);

test('selected audio loads first and later segments are requested serially', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。丙丙丙丙丙丙丙丙丙丙丙。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    assert.deepEqual(slots.map(s => s.index), [0]);
    slots[0].emit('ready');
    await Promise.resolve();
    assert.equal(controller.getSnapshot().status, 'playing');
    assert.deepEqual(slots.map(s => s.index), [0, 1]);
    slots[1].emit('ready');
    assert.deepEqual(slots.map(s => s.index), [0, 1, 2]);
    assert.equal(controller.session.currentIndex, 0);
    slots[0].emit('ended');
    await Promise.resolve();
    assert.equal(controller.session.currentIndex, 1);
    assert.equal(controller.getSnapshot().status, 'playing');
});

test('pause preserves slot and current time, resume continues it', async () => {
    const { host, slots, controller } = makeController('这是一个足够长的测试句子，用来测试暂停和恢复不会从头开始。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const first = byIndex(slots, 0);
    first.emit('ready');
    await Promise.resolve();
    first.currentTime = 4.2;
    assert.equal(controller.pause(), true);
    assert.equal(controller.getSnapshot().status, 'paused');
    assert.equal(controller.session.currentTime, 4.2);
    await controller.resume();
    assert.equal(controller.getSnapshot().status, 'playing');
    assert.equal(first.currentTime, 4.2);
});

test('one automatic retry then action required', async () => {
    const { host, slots, controller } = makeController('这是第一段，会失败并重试。后面还有第二段。', { retryCount: 1, maxInFlight: 1 });
    await controller.narrateCandidate(host.candidate(), 'manual');
    const firstAttempt = byIndex(slots, 0);
    firstAttempt.emit('error', { code: 4 });
    const secondAttempt = byIndex(slots, 0);
    assert.notEqual(firstAttempt, secondAttempt);
    secondAttempt.emit('error', { code: 4 });
    assert.equal(controller.getSnapshot().status, 'action-required');
    assert.equal(controller.getSnapshot().reason, 'segment-error');
});

test('message revision mutation cancels stale slots and rebuilds', async () => {
    const { host, slots, controller } = makeController('旧版本消息，需要在编辑后立刻失效。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const oldSlot = byIndex(slots, 0);
    const oldHash = controller.session.source.revisionHash;
    host.messages[0].mes = '新版本消息，旧音频不能再播放。';
    await controller.handleHostMutation('edited');
    assert.equal(oldSlot.disposed, true);
    assert.notEqual(controller.session.source.revisionHash, oldHash);
});

test('checkpoint contains no source text', async () => {
    const { host, checkpointStore, controller } = makeController('这是一句绝对不能写入恢复点的私密测试文本。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const serialized = JSON.stringify(checkpointStore.value);
    assert.equal(serialized.includes('私密测试文本'), false);
    assert.equal(typeof checkpointStore.value.revisionHash, 'string');
});

test('automatic narration keeps only the latest pending reply', async () => {
    const { host, controller } = makeController('first active reply that is long enough to remain active');
    await controller.narrateCandidate(host.candidate(), 'auto');
    host.messages.push({ name: 'A', is_user: false, is_system: false, mes: 'second reply', swipe_id: 0 });
    await controller.handleAssistantFinalized(host.candidate(1));
    host.messages.push({ name: 'A', is_user: false, is_system: false, mes: 'third latest reply', swipe_id: 0 });
    await controller.handleAssistantFinalized(host.candidate(2));
    assert.equal(controller.pendingAuto.index, 2);
    assert.equal(controller.getSnapshot().pendingAuto, true);
});

test('future segment failure does not interrupt the current playback', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。丙丙丙丙丙丙丙丙丙丙丙。', { retryCount: 0 });
    await controller.narrateCandidate(host.candidate(), 'manual');
    slots[0].emit('ready');
    await Promise.resolve();
    assert.equal(controller.getSnapshot().status, 'playing');
    const second = byIndex(slots, 1);
    assert.ok(second);
    second.emit('error', { code: 4 });
    assert.equal(controller.getSnapshot().status, 'playing');
});

test('checkpoint restore reconstructs source without autoplay', async () => {
    const firstRun = makeController('这是一个用于测试恢复点的长句子，刷新页面以后不应该自动开口播放。');
    await firstRun.controller.narrateCandidate(firstRun.host.candidate(), 'manual');
    const slot = byIndex(firstRun.slots, 0);
    slot.emit('ready');
    await Promise.resolve();
    slot.currentTime = 3.5;
    firstRun.controller.pause();
    const saved = structuredClone(firstRun.checkpointStore.value);

    const secondRun = makeController(firstRun.host.messages[0].mes);
    secondRun.checkpointStore.value = saved;
    const restored = await secondRun.controller.tryRestoreCheckpoint();
    assert.equal(restored, true);
    assert.equal(secondRun.controller.getSnapshot().status, 'paused');
    assert.equal(secondRun.controller.getSnapshot().reason, 'restore');
    assert.equal(secondRun.slots.length, 0);
});

test('deleting active source clears pending auto work with unstable indices', async () => {
    const { host, controller } = makeController('active reply remains in progress');
    await controller.narrateCandidate(host.candidate(), 'auto');
    host.messages.push({ name: 'A', is_user: false, is_system: false, mes: 'pending reply', swipe_id: 0 });
    await controller.handleAssistantFinalized(host.candidate(1));
    assert.equal(controller.getSnapshot().pendingAuto, true);
    await controller.handleHostMutation('deleted');
    assert.equal(controller.getSnapshot().hasSession, false);
    assert.equal(controller.getSnapshot().pendingAuto, false);
});


test('manual narration can target an older assistant message', async () => {
    const { host, controller } = makeController('older reply');
    host.messages.push({ name: 'A', is_user: false, is_system: false, mes: 'latest reply', swipe_id: 0 });
    await controller.narrateMessage(0);
    assert.equal(controller.session.source.index, 0);
    assert.equal(controller.session.source.text, 'older reply');
});

test('next segment reuses already prepared audio without new TTS request', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const first = byIndex(slots, 0);
    first.emit('ready');
    const second = byIndex(slots, 1);
    second.emit('ready');
    await Promise.resolve();
    assert.equal(controller.next(), true);
    await Promise.resolve();
    assert.equal(controller.session.currentIndex, 1);
    assert.equal(controller.getSnapshot().status, 'playing');
    assert.equal(second.disposed, false);
    assert.equal(slots.length, 2);
});

test('previous segment replays cached audio and retains the next segment', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const first = slots[0];
    first.emit('ready');
    const second = byIndex(slots, 1);
    second.emit('ready');
    controller.next();
    await Promise.resolve();
    assert.equal(controller.session.currentIndex, 1);
    // Simulate a later, single navigation rather than a rapid-jump burst.
    controller.lastNavigationAt = -Infinity;
    controller.previous();
    await Promise.resolve();
    assert.equal(controller.session.currentIndex, 0);
    assert.equal(controller.getSnapshot().status, 'playing');
    assert.equal(byIndex(slots, 0), first);
    assert.equal(second.disposed, false);
    assert.equal(slots.length, 2);
});

test('previous cached segment preempts an in-progress future load', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const first = slots[0];
    first.emit('ready');
    const second = byIndex(slots, 1);
    assert.equal(controller.session.segments[1].state, 'loading');
    first.emit('ended');
    await Promise.resolve();
    controller.previous();
    await Promise.resolve();
    assert.equal(second.disposed, true);
    assert.equal(controller.session.currentIndex, 0);
    assert.equal(byIndex(slots, 0), first);
    assert.equal(controller.getSnapshot().status, 'playing');
});

test('narration filters code and tagged blocks before segmentation', async () => {
    const text = '开头。\n\`\`\`js\nsecretCode();\n\`\`\`\n<Tag>秘密标签内容</Tag>\n结尾。';
    const { host, controller } = makeController(text, { skipCodeBlocks: true, skipTagBlocks: true });
    await controller.narrateCandidate(host.candidate(), 'manual');
    assert.equal(controller.session.source.text.includes('secretCode'), false);
    assert.equal(controller.session.source.text.includes('秘密标签内容'), false);
    assert.deepEqual(controller.session.segments.map(segment => segment.text), ['开头。', '结尾。']);
});

test('diagnostics distinguish real current playback stalls from background load stalls', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const first = slots[0];
    first.emit('ready');
    const second = byIndex(slots, 1);
    second.emit('stalled');
    second.emit('ready');
    await Promise.resolve();
    first.emit('waiting');
    first.emit('playing');
    first.emit('ended');
    await Promise.resolve();
    const nextStarted = controller.diagnostics.find(event => event.event === 'segment-playing' && event.index === 1);
    assert.ok(nextStarted);
    assert.ok(Number.isFinite(nextStarted.gapMs));
    assert.ok(Number.isFinite(nextStarted.startDelayMs));
    assert.ok(controller.diagnostics.some(event => event.event === 'media-waiting' && event.index === 0));
    assert.equal(nextStarted.stalledMs, 0);
});

test('comment-only assistant replies report why nothing can be narrated', async () => {
    const { controller } = makeController('<!-- hidden preset instructions -->');
    const ok = await controller.narrateLatestManual();
    assert.equal(ok, false);
    assert.equal(controller.getSnapshot().reason, 'empty-text');
    const event = controller.diagnostics.find(item => item.event === 'source-empty-after-filter');
    assert.ok(event);
    assert.equal(event.originalChars > 0, true);
    assert.equal(JSON.stringify(event).includes('hidden preset'), false);
});

test('copying the latest narration text follows the same filter as playback', async () => {
    const text = '<thinking>hidden</thinking>「日期地点」<content>真正要朗读的正文。</content><details>概要</details>';
    const { host, controller } = makeController(text, { skipTagBlocks: true });
    assert.equal(controller.getLatestReplyText(), '「日期地点」\n真正要朗读的正文。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    assert.deepEqual(controller.session.segments.map(s => s.text), ['「日期地点」', '真正要朗读的正文。']);
    assert.ok(controller.diagnostics.some(item => item.event === 'source-prepared'
        && item.inputChars > item.preparedChars && item.skipTagBlocks));
    assert.equal(JSON.stringify(controller.diagnostics).includes('真正要朗读'), false);
});

// A burst of navigation should coalesce into one synthesis request.
test('rapid jumps do not synthesize discarded intermediate targets', async () => {
    const { host, slots, controller } = makeController('这是一句完整的测试。'.repeat(28));
    await controller.narrateCandidate(host.candidate(), 'manual');
    assert.equal(slots.length, 1);
    controller.next();
    controller.next();
    controller.next();
    assert.equal(slots.length, 1);
    await new Promise(resolve => setTimeout(resolve, 2100));
    assert.equal(slots.at(-1).index, 3);
    assert.deepEqual(slots.map(s => s.index), [0, 3]);
    await controller.stop();
});

test('diagnostic segment export reflects exact current session boundaries', async () => {
    const { host, controller } = makeController('第一句。第二句。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    const text = controller.getActiveSegmentText();
    assert.ok(text.includes('[1]'));
    assert.ok(text.includes('第一句。'));
    await controller.stop();
    assert.equal(controller.getActiveSegmentText(), null);
});
