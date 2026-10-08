import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsStore, DIAGNOSTICS_KEY } from '../src/settings.js';

class MemoryStorage {
    data = new Map();
    getItem(key) { return this.data.get(key) ?? null; }
    setItem(key, value) { this.data.set(key, value); }
    removeItem(key) { this.data.delete(key); }
}

test('diagnostics survive a store reload without persisting narration text', () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);
    store.append({ at: 100, event: 'segment-ready', index: 3, loadMs: 120 });
    store.persist();
    const restored = new DiagnosticsStore(storage);
    assert.deepEqual(restored.read(), [{ at: 100, event: 'segment-ready', index: 3, loadMs: 120 }]);
    assert.equal(storage.getItem(DIAGNOSTICS_KEY).includes('narration text'), false);
    restored.clear();
    assert.deepEqual(new DiagnosticsStore(storage).read(), []);
});

test('journal stays bounded across long playback sessions', () => {
    const storage = new MemoryStorage();
    const store = new DiagnosticsStore(storage);
    for (let i = 0; i < 2010; i++) store.append({ at: i, event: 'media-progress' });
    store.persist();
    assert.equal(new DiagnosticsStore(storage).read().length, 2000);
    assert.equal(store.read()[0].at, 10);
});
