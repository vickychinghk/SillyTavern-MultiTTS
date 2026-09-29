import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNarrationText, segmentNarrationText, sha256Hex } from '../src/text.js';

test('normalization preserves line boundaries and removes image markdown', () => {
    const value = normalizeNarrationText('  第一行。\n\n![x](a.png)\n第二行。  ');
    assert.equal(value, '第一行。\n\n\n第二行。');
});

test('every non-empty source line is a hard segment boundary', () => {
    assert.deepEqual(segmentNarrationText('甲\n乙\n丙', 1000), ['甲', '乙', '丙']);
});

test('long lines prefer the rightmost complete sentence before weaker punctuation', () => {
    const text = '第一句完整。第二句还没有结束，但这里已经接近限制仍然继续';
    const segments = segmentNarrationText(text, 20);
    assert.equal(segments[0], '第一句完整。');
    assert.equal(segments.join(''), text);
});

test('long sentences use a late clause boundary before hard cutting', () => {
    const text = '这是一条没有句号但内容非常长的句子，需要继续表达很多内容，最后才结束';
    const segments = segmentNarrationText(text, 20);
    assert.ok(segments.length > 1);
    assert.ok(segments[0].endsWith('，'));
    assert.equal(segments.join(''), text);
});

test('segmentation supports a configured limit of 1000 code points', () => {
    const text = '字'.repeat(999);
    assert.deepEqual(segmentNarrationText(text, 1000), [text]);
    const longer = '字'.repeat(1001);
    const segments = segmentNarrationText(longer, 1000);
    assert.equal(Array.from(segments[0]).length, 1000);
    assert.equal(Array.from(segments[1]).length, 1);
});

test('segmentation counts Unicode code points instead of UTF-16 units', () => {
    const segments = segmentNarrationText('😀'.repeat(21), 20);
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
