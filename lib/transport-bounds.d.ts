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
export declare class ResponseTooLargeError extends Error {
    readonly maxBytes: number;
    constructor(maxBytes: number);
}
/**
 * Read a response body as text, refusing one over the ceiling.
 * @param response - the response to drain.
 * @param maxBytes - the byte ceiling.
 * @returns the decoded body.
 * @throws {ResponseTooLargeError} when the body exceeds the ceiling.
 */
export declare function readBoundedText(response: Response, maxBytes: number): Promise<string>;
/**
 * Read a response body as bytes, refusing one over the ceiling.
 * @param response - the response to drain.
 * @param maxBytes - the byte ceiling.
 * @returns the body bytes.
 * @throws {ResponseTooLargeError} when the body exceeds the ceiling.
 */
export declare function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array>;
//# sourceMappingURL=transport-bounds.d.ts.map