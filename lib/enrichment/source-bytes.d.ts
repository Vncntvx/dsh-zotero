/**
 * Obtain the exact bytes of one document to send to MinerU, and probe the
 * source cheaply enough for the cache to answer first.
 *
 * Two authorized sources, both gated by the service before this module runs:
 * a local Zotero attachment (resolved through the core's `resolveAttachment`,
 * then read from disk) and a public URL PDF (downloaded through the same
 * public-address double gate as the URL-PDF reader). Internal parse callers
 * may also provide already acquired bytes; ordinary scholarly reads never
 * enter this acquisition path. Every parse arm checks the PDF signature and
 * the selected API's byte cap.
 *
 * `probeSource` only runs after its caller finds an index candidate: a local
 * attachment is only `stat`ed, a URL receives at most one HEAD operation (no
 * token), and caller-supplied bytes are only hashed. `obtainSourceBytes`
 * returns the bytes, source stamp, and actual URL request/terminal identities
 * the service records in the source index.
 * @module dsh-zotero/enrichment/source-bytes
 */
import type { ParseSourceInput, FulltextSourceStamp } from './types.js';
import type { MineruClient } from './transport.js';
/** The resolved shape of one local attachment, as the core reports it. */
export interface ResolvedAttachment {
    readonly kind: 'file' | 'url';
    readonly path?: string;
    readonly url?: string;
}
/** Host seams, injectable so unit tests never touch a real disk or socket. */
export interface SourceBytesDeps {
    readonly resolveAttachment: (ref: string, signal?: AbortSignal) => Promise<ResolvedAttachment>;
    readonly stat: (path: string) => Promise<{
        size: number;
        mtimeMs: number;
    }>;
    readonly readFile: (path: string, signal?: AbortSignal) => Promise<Uint8Array>;
    readonly client: MineruClient;
}
/** Bytes plus the source stamp the cache records. */
export interface SourceBytesResult {
    readonly bytes: Uint8Array;
    readonly stamp: FulltextSourceStamp;
    /** Present only for an actual URL acquisition, including linked attachments. */
    readonly urlSource?: {
        readonly requestedUrl: string;
        readonly finalUrl: string;
    };
}
/** Validate PDF signature and size; return the bytes unchanged. */
export declare function validatedPdfBytes(bytes: Uint8Array, maxBytes: number): Uint8Array;
/** Build a URL stamp from response headers, keeping only useful validators. */
export declare function urlStampOf(url: string, headers: Headers): FulltextSourceStamp;
/**
 * Probe the source without reading the document. A caller-supplied stamp wins;
 * otherwise a local file is `stat`ed, a URL gets one HEAD, and supplied bytes
 * are hashed.
 */
export declare function probeSource(input: ParseSourceInput, maxBytes: number, deps: SourceBytesDeps, signal?: AbortSignal): Promise<FulltextSourceStamp>;
/**
 * Obtain document bytes. Bytes passed in by the caller win; otherwise the
 * source is resolved.
 *
 * MinerU parsing is authorized by mounting the enrichment component, which is
 * the deployment's acceptance of document egress; the caller has already
 * required the user's explicit submission of this one target and passed the
 * remote-action and session checks before this module runs. Nothing here asks
 * again, and nothing here can authorize a second target.
 */
export declare function obtainSourceBytes(input: ParseSourceInput, maxBytes: number, deps: SourceBytesDeps, signal?: AbortSignal): Promise<SourceBytesResult>;
/** Production deps: real disk reads plus the core's attachment resolver. */
export declare function hostSourceBytesDeps(resolveAttachment: SourceBytesDeps['resolveAttachment'], client: MineruClient): SourceBytesDeps;
//# sourceMappingURL=source-bytes.d.ts.map