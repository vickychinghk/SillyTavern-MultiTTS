import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNarrationText, segmentNarrationText, sha256Hex } from '../src/text.js';

test('normalization preserves paragraph boundaries and removes image markdown', () => {
    const value = normalizeNarrationText('  第一段。\n\n![x](a.png)\n第二段。  ');
    assert.equal(value, '第一段。\n\n\n第二段。'.replace(/\n{3,}/, '\n\n'));
});

test('segmentation prefers paragraph and punctuation boundaries', () => {
    const segments = segmentNarrationText('第一段很短。\n\n第二段有一句话，接着还有一句话！最后结束。', 12);
    assert.deepEqual(segments[0], '第一段很短。');
    assert.ok(segments.every(segment => Array.from(segment).length <= 20));
    assert.equal(segments.join('').replace(/\s/g, ''), '第一段很短。第二段有一句话，接着还有一句话！最后结束。');
});

test('segmentation counts Unicode code points instead of UTF-16 units', () => {
    const segments = segmentNarrationText('😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀', 20);
    assert.equal(segments.length, 2);
    assert.equal(Array.from(segments[0]).length, 20);
    assert.equal(Array.from(segments[1]).length, 1);
});

test('segmentation is deterministic and never emits empty segments', () => {
    const text = 'A long sentence without useful punctuation but with words that need deterministic splitting for playback.';
    const a = segmentNarrationText(text, 30);
    const b = segmentNarrationText(text, 30);
    assert.deepEqual(a, b);
    assert.ok(a.length > 1);
    assert.ok(a.every(Boolean));
});

test('sha256 is stable', async () => {
    assert.equal(await sha256Hex('abc'), await sha256Hex('abc'));
    assert.notEqual(await sha256Hex('abc'), await sha256Hex('abcd'));
});
