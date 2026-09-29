import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SillyTavernHost } from '../src/host.js';

const eventTypes = {
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    GENERATION_STOPPED: 'generation_stopped',
    MESSAGE_RECEIVED: 'message_received',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
    CHAT_CHANGED: 'chat_changed',
};

function setup() {
    const eventSource = new EventEmitter();
    const context = {
        eventSource,
        eventTypes,
        chatId: 'chat-1',
        chat: [{ name: 'A', is_user: false, is_system: false, mes: 'existing', swipe_id: 0 }],
        extensionSettings: {},
        saveSettingsDebounced() {},
    };
    const win = { SillyTavern: { getContext: () => context } };
    return { context, eventSource, host: new SillyTavernHost(win) };
}

test('generation end only announces when the canonical assistant changed', async () => {
    const { context, eventSource, host } = setup();
    const seen = [];
    host.subscribe({ onAssistantFinalized: candidate => seen.push(candidate) });
    eventSource.emit(eventTypes.GENERATION_STARTED);
    eventSource.emit(eventTypes.GENERATION_ENDED);
    await Promise.resolve();
    assert.equal(seen.length, 0);

    eventSource.emit(eventTypes.GENERATION_STARTED);
    context.chat.push({ name: 'A', is_user: false, is_system: false, mes: 'new reply', swipe_id: 0 });
    eventSource.emit(eventTypes.GENERATION_ENDED);
    await Promise.resolve();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].text, 'new reply');
});

test('message received announces a new assistant message outside generation', async () => {
    const { context, eventSource, host } = setup();
    const seen = [];
    host.subscribe({ onAssistantFinalized: candidate => seen.push(candidate) });
    context.chat.push({ name: 'A', is_user: false, is_system: false, mes: 'extension reply', swipe_id: 0 });
    eventSource.emit(eventTypes.MESSAGE_RECEIVED, 1);
    await Promise.resolve();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].index, 1);
});

test('disposing subscriptions prevents duplicate callbacks', async () => {
    const { context, eventSource, host } = setup();
    let count = 0;
    host.subscribe({ onAssistantFinalized: () => count++ });
    host.disposeSubscriptions();
    context.chat.push({ name: 'A', is_user: false, is_system: false, mes: 'new', swipe_id: 0 });
    eventSource.emit(eventTypes.MESSAGE_RECEIVED, 1);
    await Promise.resolve();
    assert.equal(count, 0);
});


test('message render events are exposed for host-native message controls', () => {
    const { eventSource, host } = setup();
    const rendered = [];
    let loaded = 0;
    host.subscribe({
        onMessageRendered: index => rendered.push(index),
        onMessagesLoaded: () => loaded++,
    });
    eventSource.emit(eventTypes.CHARACTER_MESSAGE_RENDERED, 3);
    eventSource.emit(eventTypes.MORE_MESSAGES_LOADED);
    assert.deepEqual(rendered, [3]);
    assert.equal(loaded, 1);
});
