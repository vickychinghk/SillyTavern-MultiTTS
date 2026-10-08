const SENTENCE_END = /[。！？!?…]/u;
const CLAUSE_BREAK = /[；;：:]/u;
const WEAK_BREAK = /[，,、]/u;
const CLOSER = /["'”’」』）》】〉]/u;
const FALLBACK_RATIO = 0.6;

// The host message may contain visible HTML alongside hidden prompt/preset comments.
// Remove non-spoken markup before segmentation, preserving text inside presentation tags.
export function filterNarrationText(input, { skipCodeBlocks = false, skipTagBlocks = false } = {}) {
    let text = String(input ?? '').replace(/<!--[\\s\\S]*?-->/g, '');
    if (skipCodeBlocks) {
        text = text.replace(/```[\\s\\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
    }
    if (skipTagBlocks) {
        // Skip semantic/custom blocks but retain visible HTML paragraphs and formatting.
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

function splitLine(line, maxChars) {
    const chars = codePoints(line.trim());
    if (!chars.length) return [];
    const segments = [];
    let start = 0;

    while (start < chars.length) {
        const remaining = chars.length - start;
        if (remaining <= maxChars) {
            segments.push(chars.slice(start).join('').trim());
            break;
        }

        const end = start + maxChars;
        let cut = findBreak(chars, start, end, SENTENCE_END);
        if (cut < 0) {
            const minFallback = start + Math.floor(maxChars * FALLBACK_RATIO);
            cut = findBreak(chars, start, end, CLAUSE_BREAK, minFallback);
            if (cut < 0) cut = findBreak(chars, start, end, WEAK_BREAK, minFallback);
            if (cut < 0) {
                for (let i = end - 1; i >= minFallback; i--) {
                    if (/\s/u.test(chars[i])) {
                        cut = i + 1;
                        break;
                    }
                }
            }
        }
        if (cut <= start) cut = end;

        const segment = chars.slice(start, cut).join('').trim();
        if (segment) segments.push(segment);
        start = cut;
        while (start < chars.length && /\s/u.test(chars[start])) start++;
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
