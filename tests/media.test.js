import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForwardUrl, isLoopbackEndpoint, normalizeEndpoint } from '../src/media.js';

const settings = { speed: 50, volume: 100, pitch: 50 };

test('normalizes endpoint without forward or voices suffix', () => {
    assert.equal(normalizeEndpoint('http://127.0.0.1:8774/forward'), 'http://127.0.0.1:8774');
    assert.equal(normalizeEndpoint('http://localhost:8774/voices/'), 'http://localhost:8774');
});

test('buildForwardUrl encodes text once and omits voice', () => {
    const url = new URL(buildForwardUrl('http://127.0.0.1:8774', '你好 & hello', settings));
    assert.equal(url.pathname, '/forward');
    assert.equal(url.searchParams.get('text'), '你好 & hello');
    assert.equal(url.searchParams.get('speed'), '50');
    assert.equal(url.searchParams.has('voice'), false);
});

test('loopback detection is strict', () => {
    assert.equal(isLoopbackEndpoint('http://127.0.0.1:8774'), true);
    assert.equal(isLoopbackEndpoint('http://localhost:8774'), true);
    assert.equal(isLoopbackEndpoint('https://example.com/tts'), false);
});
