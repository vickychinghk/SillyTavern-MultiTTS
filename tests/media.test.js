import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForwardUrl, isLoopbackEndpoint, normalizeEndpoint } from '../src/media.js';
import { normalizeSettings, settingsFingerprintInput } from '../src/settings.js';

const settings = { sendProsodyParams: true, speed: 50, volume: 100, pitch: 50 };

test('normalizes endpoint without forward or voices suffix', () => {
    assert.equal(normalizeEndpoint('http://127.0.0.1:8774/forward'), 'http://127.0.0.1:8774');
    assert.equal(normalizeEndpoint('http://localhost:8774/voices/'), 'http://localhost:8774');
});

test('buildForwardUrl includes optional tuning params but never voice', () => {
    const url = new URL(buildForwardUrl('http://127.0.0.1:8774', '你好 & hello', settings));
    assert.equal(url.pathname, '/forward');
    assert.equal(url.searchParams.get('text'), '你好 & hello');
    assert.equal(url.searchParams.get('speed'), '50');
    assert.equal(url.searchParams.get('volume'), '100');
    assert.equal(url.searchParams.get('pitch'), '50');
    assert.equal(url.searchParams.has('voice'), false);
});

test('buildForwardUrl can send text only', () => {
    const url = new URL(buildForwardUrl('http://127.0.0.1:8774', '你好', { ...settings, sendProsodyParams: false }));
    assert.deepEqual([...url.searchParams.keys()], ['text']);
    assert.equal(url.searchParams.get('text'), '你好');
});

test('settings allow segment sizes up to 1000', () => {
    assert.equal(normalizeSettings({ segmentChars: 1000 }).segmentChars, 1000);
    assert.equal(normalizeSettings({ segmentChars: 1200 }).segmentChars, 1000);
});

test('disabled tuning values do not invalidate recovery fingerprint', () => {
    const a = settingsFingerprintInput({ sendProsodyParams: false, speed: 10, volume: 20, pitch: 30 });
    const b = settingsFingerprintInput({ sendProsodyParams: false, speed: 90, volume: 80, pitch: 70 });
    assert.equal(a, b);
});

test('loopback detection is strict', () => {
    assert.equal(isLoopbackEndpoint('http://127.0.0.1:8774'), true);
    assert.equal(isLoopbackEndpoint('http://localhost:8774'), true);
    assert.equal(isLoopbackEndpoint('https://example.com/tts'), false);
});
