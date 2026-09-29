const STRONG_BREAK = /[。！？!?；;]/;
const WEAK_BREAK = /[，,、：:]/;

export function normalizeNarrationText(input) {
    return String(input ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/<img\b[^>]*>/gi, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function codePoints(text) {
    return Array.from(text);
}

function findBreak(chars, start, end, minBreak, matcher) {
    for (let i = end - 1; i >= minBreak; i--) {
        if (matcher.test(chars[i])) return i + 1;
    }
    return -1;
}

function splitParagraph(paragraph, maxChars) {
    const chars = codePoints(paragraph.trim());
    if (!chars.length) return [];
    if (chars.length <= maxChars) return [chars.join('')];

    const result = [];
    let start = 0;
    while (start < chars.length) {
        const remaining = chars.length - start;
        if (remaining <= maxChars) {
            result.push(chars.slice(start).join('').trim());
            break;
        }

        const hardEnd = start + maxChars;
        const minBreak = start + Math.max(1, Math.floor(maxChars * 0.45));
        let cut = findBreak(chars, start, hardEnd, minBreak, STRONG_BREAK);
        if (cut < 0) cut = findBreak(chars, start, hardEnd, minBreak, WEAK_BREAK);
        if (cut < 0) {
            for (let i = hardEnd - 1; i >= minBreak; i--) {
                if (/\s/.test(chars[i])) {
                    cut = i + 1;
                    break;
                }
            }
        }
        if (cut <= start) cut = hardEnd;

        const segment = chars.slice(start, cut).join('').trim();
        if (segment) result.push(segment);
        start = cut;
        while (start < chars.length && /\s/.test(chars[start])) start++;
    }

    if (result.length > 1) {
        const tail = result[result.length - 1];
        const previous = result[result.length - 2];
        if (codePoints(tail).length < Math.floor(maxChars * 0.2)
            && codePoints(`${previous}${tail}`).length <= maxChars) {
            result.splice(result.length - 2, 2, `${previous}${tail}`);
        }
    }

    return result;
}

export function segmentNarrationText(input, maxChars = 70) {
    const max = Math.max(20, Math.min(300, Number(maxChars) || 70));
    const text = normalizeNarrationText(input);
    if (!text) return [];

    const paragraphs = text.split(/\n+/).map(x => x.trim()).filter(Boolean);
    return paragraphs.flatMap(paragraph => splitParagraph(paragraph, max)).filter(Boolean);
}

export async function sha256Hex(input) {
    const bytes = new TextEncoder().encode(String(input ?? ''));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
