import test from 'node:test';
import assert from 'node:assert/strict';
import { filterNarrationText, normalizeNarrationText, prepareNarrationText, segmentNarrationText, sha256Hex } from '../src/text.js';

test('normalization preserves line boundaries and removes image markdown', () => {
    const value = normalizeNarrationText('  第一行。\n\n![x](a.png)\n第二行。  ');
    assert.equal(value, '第一行。\n\n\n第二行。');
});


test('code block skipping matches SillyTavern TTS fenced-block behavior', () => {
    const input = '开头\n\`\`\`js\nconst x = 1;\n\`\`\`\n中间\n~~~\nyaml: true\n~~~\n结尾';
    const filtered = filterNarrationText(input, { skipCodeBlocks: true });
    assert.equal(filtered.includes('const x = 1'), false);
    assert.equal(filtered.includes('yaml: true'), false);
    assert.deepEqual(segmentNarrationText(filtered, 1000), ['开头', '中间', '结尾']);
});

test('tag block skipping removes paired tagged content', () => {
    const input = '保留<Tag>跳过这里</Tag>继续<think>也跳过</think>结束';
    assert.equal(
        prepareNarrationText(input, { skipTagBlocks: true }),
        '保留继续结束',
    );
});

test('content filters are opt-in', () => {
    const input = '前\n\`\`\`code\`\`\`\n<Tag>内容</Tag>后';
    assert.equal(prepareNarrationText(input), normalizeNarrationText(input));
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

test('decorated assistant replies preserve visible paragraphs and ignore hidden comments', () => {
    const input = '<!-- hidden preset -->正文第一段。<!-- note -->\n<p style="color: #abc">【角色】可朗读的对话。</p>\n普通正文。<!-- end -->';
    const prepared = prepareNarrationText(input);
    assert.equal(prepared.includes('hidden'), false);
    assert.equal(prepared.includes('style='), false);
    assert.equal(prepared.includes('<!--'), false);
    assert.deepEqual(segmentNarrationText(prepared, 1000), [
        '正文第一段。', '【角色】可朗读的对话。', '普通正文。',
    ]);
});

test('skipping custom tag blocks does not delete visible HTML paragraph content', () => {
    const input = '<think>hidden reasoning</think><p style="color: red">展示的文本。</p>';
    assert.equal(prepareNarrationText(input, { skipTagBlocks: true }), '展示的文本。');
});
