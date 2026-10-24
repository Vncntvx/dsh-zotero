/**
 * Bounded response-body readers shared by the local Zotero transport and the
 * scholarly transport.
 *
 * One implementation, because two would disagree: a stack that accumulates
 * `Uint8Array` chunks and copies them into a fresh buffer also carries its own
 * default ceiling, and the two ceilings drift apart. These helpers decode as
 * they read, so a large body costs one pass and one string.
 *
 * @module dsh-zotero/transport-bounds
 */
/** Raised when a response body exceeds its byte ceiling. */
export class ResponseTooLargeError extends Error {
    maxBytes;
    constructor(maxBytes) {
        super(`Response larger than maximum allowed size (${Math.round(maxBytes / 1_048_576)} MB)`);
        this.maxBytes = maxBytes;
        this.name = 'ResponseTooLargeError';
    }
}
/**
 * Read a response body as text, refusing one over the ceiling.
 * @param response - the response to drain.
 * @param maxBytes - the byte ceiling.
 * @returns the decoded body.
 * @throws {ResponseTooLargeError} when the body exceeds the ceiling.
 */
export async function readBoundedText(response, maxBytes) {
    const reader = response.body?.getReader();
    if (reader === undefined) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes)
            throw new ResponseTooLargeError(maxBytes);
        return new TextDecoder().decode(buffer);
    }
    const parts = [];
    const decoder = new TextDecoder();
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new ResponseTooLargeError(maxBytes);
            }
            parts.push(decoder.decode(value, { stream: true }));
        }
    }
    finally {
        reader.releaseLock();
    }
    // One join: repeated concatenation would copy the whole body per chunk.
    return parts.join('') + decoder.decode();
}
/**
 * Read a response body as bytes, refusing one over the ceiling.
 * @param response - the response to drain.
 * @param maxBytes - the byte ceiling.
 * @returns the body bytes.
 * @throws {ResponseTooLargeError} when the body exceeds the ceiling.
 */
export async function readBoundedBytes(response, maxBytes) {
    const reader = response.body?.getReader();
    if (reader === undefined) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes)
            throw new ResponseTooLargeError(maxBytes);
        return new Uint8Array(buffer);
    }
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new ResponseTooLargeError(maxBytes);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    if (chunks.length === 1)
        return chunks[0];
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}
//# sourceMappingURL=transport-bounds.js.map