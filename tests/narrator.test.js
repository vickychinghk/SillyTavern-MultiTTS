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

test('out-of-order readiness still plays strictly in order', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。丙丙丙丙丙丙丙丙丙丙丙。');
    await controller.narrateCandidate(host.candidate(), 'manual');
    assert.ok(slots.length >= 2);
    const first = byIndex(slots, 0);
    const second = byIndex(slots, 1);
    second.emit('ready');
    assert.notEqual(controller.getSnapshot().status, 'playing');
    first.emit('ready');
    await Promise.resolve();
    assert.equal(controller.getSnapshot().status, 'playing');
    assert.equal(controller.session.currentIndex, 0);
    first.emit('ended');
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

test('future segment failure does not falsely mark current playing audio as stopped', async () => {
    const { host, slots, controller } = makeController('甲甲甲甲甲甲甲甲甲甲甲。乙乙乙乙乙乙乙乙乙乙乙。丙丙丙丙丙丙丙丙丙丙丙。', { retryCount: 0 });
    await controller.narrateCandidate(host.candidate(), 'manual');
    const first = byIndex(slots, 0);
    const second = byIndex(slots, 1);
    first.emit('ready');
    await Promise.resolve();
    assert.equal(controller.getSnapshot().status, 'playing');
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
