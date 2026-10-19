const SENTENCE_END = /[。！？!?…]/u;
const CLAUSE_BREAK = /[；;：:]/u;
const WEAK_BREAK = /[，,、]/u;
const CLOSER = /["'”’」』）》】〉]/u;
const MIN_PUNCTUATION_RATIO = 0.35;
const wordSegmenter = typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;

// The host message may contain visible HTML alongside hidden prompt/preset comments.
// Remove non-spoken markup before segmentation, preserving text inside presentation tags.
export function filterNarrationText(input, { skipCodeBlocks = false, skipTagBlocks = false } = {}) {
    let text = String(input ?? '').replace(/<!--[\s\S]*?-->/g, '');
    // Reasoning and auxiliary details are not spoken, irrespective of optional custom-tag skipping.
    text = text.replace(/<(thinking|think|analysis|reasoning|details)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    // Model replies often put their entire visible body in a <content> wrapper.
    // Unwrap it BEFORE skipping custom tags, or only the outside timestamp survives.
    text = text.replace(/<\/?content\b[^>]*>/gi, '\n');
    if (skipCodeBlocks) {
        text = text.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
    }
    if (skipTagBlocks) {
        // Skip arbitrary custom blocks, but preserve standard visible HTML.
        text = text.replace(/<(?!\/?(?:p|span|div|br|b|strong|em|i|u|blockquote|li|ul|ol|h[1-6])\b)([a-z][\w:-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    }
    return text.trim();
}

export function normalizeNarrationText(input) {
    return String(input ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<\/(?:p|div|li|blockquote|h[1-6])\s*>/gi, '\n')
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .trim();
}

export function prepareNarrationText(input, options = {}) {
    return normalizeNarrationText(filterNarrationText(input, options));
}

const codePoints = text => Array.from(text);

function findBreak(chars, start, end, matcher, min = start) {
    for (let i = end - 1; i >= min; i--) {
        if (!matcher.test(chars[i])) continue;
        let cut = i + 1;
        while (cut < end && CLOSER.test(chars[cut])) cut++;
        return cut;
    }
    return -1;
}

// Prefer complete punctuation clauses and Unicode word boundaries to hard cuts.
function findWordBoundary(chars, start, end, maxChars) {
    if (!wordSegmenter) return -1;
    const text = chars.slice(start).join('');
    const boundaries = Array.from(wordSegmenter.segment(text), part =>
        start + Array.from(text.slice(0, part.index + part.segment.length)).length);
    const min = start + Math.max(1, Math.floor(maxChars * 0.45));
    const before = boundaries.filter(pos => pos <= end && pos >= min);
    if (before.length) return before.at(-1);
    return -1; // Character setting is a hard upper bound for TTS.
}

function splitLine(line, maxChars) {
    const chars = codePoints(line.trim());
    if (!chars.length) return [];
    const segments = [];
    let start = 0;
    while (start < chars.length) {
        if (chars.length - start <= maxChars) {
            segments.push(chars.slice(start).join('').trim());
            break;
        }
        const end = start + maxChars;
        let cut = findBreak(chars, start, end, SENTENCE_END);
        if (cut < 0) {
            const minimum = start + Math.floor(maxChars * MIN_PUNCTUATION_RATIO);
            cut = findBreak(chars, start, end, CLAUSE_BREAK, minimum);
            if (cut < 0) cut = findBreak(chars, start, end, WEAK_BREAK, minimum);
            if (cut < 0) {
                for (let i = end - 1; i >= minimum; i--) {
                    if (/\\s/u.test(chars[i])) { cut = i + 1; break; }
                }
            }
            if (cut < 0) cut = findWordBoundary(chars, start, end, maxChars);
            if (cut < 0) {
                // An early punctuation break is safer than cutting a Chinese word.
                cut = findBreak(chars, start, end, CLAUSE_BREAK);
                if (cut < 0) cut = findBreak(chars, start, end, WEAK_BREAK);
            }
        }
        if (cut <= start) cut = end;
        const segment = chars.slice(start, cut).join('').trim();
        if (segment) segments.push(segment);
        start = cut;
        while (start < chars.length && /\\s/u.test(chars[start])) start++;
    }
    return segments;
}

export function segmentNarrationText(input, maxChars = 70) {
    const max = Math.max(20, Math.min(1000, Number(maxChars) || 70));
    const text = normalizeNarrationText(input);
    if (!text) return [];

    return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .flatMap(line => splitLine(line, max));
}

export async function sha256Hex(input) {
    const bytes = new TextEncoder().encode(String(input ?? ''));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
