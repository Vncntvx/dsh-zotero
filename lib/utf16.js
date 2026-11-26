/**
 * Return a fresh string that shares no backing storage with `text`.
 *
 * V8 slices (`slice`/`substring`/`trim`) keep the parent string's characters
 * alive as long as the excerpt lives; the engine flattens a sliced string into
 * a standalone copy only after enough characters are consumed. An excerpt that
 * enters durable state — a session's tool/result meta, a projection
 * checkpoint, a storage record — would otherwise pin its full-length parent
 * (an entire fulltext body, a whole page's evidence text) for the session's
 * lifetime. The UTF-16 code-unit round-trip yields a standalone string: paired
 * surrogates survive byte-identical, a lone surrogate cannot survive the
 * round-trip and decodes to U+FFFD.
 */
export function detachUtf16(text) {
    if (text.length === 0)
        return '';
    const codeUnits = new Uint16Array(text.length);
    for (let index = 0; index < text.length; index += 1)
        codeUnits[index] = text.charCodeAt(index);
    return new TextDecoder('utf-16le').decode(codeUnits);
}
//# sourceMappingURL=utf16.js.map