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
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT, ZoteroError } from '../errors.js';
import { HEAD_TIMEOUT_MS, SOURCE_TRANSFER_TIMEOUT_MS } from './limits.js';
const PDF_MAGIC = /^\s*%PDF-\d\.\d/;
function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function refuse(reason) {
    throw new ZoteroError(`Document cannot be parsed: ${reason}`, ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT);
}
/** Validate PDF signature and size; return the bytes unchanged. */
export function validatedPdfBytes(bytes, maxBytes) {
    if (bytes.byteLength > maxBytes) {
        refuse(`the file is ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit`);
    }
    const prefix = new TextDecoder('ascii').decode(bytes.subarray(0, 1024));
    if (!PDF_MAGIC.test(prefix))
        refuse('the bytes do not carry a PDF file signature');
    return bytes;
}
function canonicalSourceUrl(url) {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
}
/** Await owned work through cleanup, preserving caller cancellation on either settlement. */
async function owned(work, signal) {
    signal?.throwIfAborted();
    try {
        const value = await work();
        signal?.throwIfAborted();
        return value;
    }
    catch (error) {
        signal?.throwIfAborted();
        throw error;
    }
}
function headerOf(headers, name) {
    const value = headers.get(name);
    if (value === null)
        return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
/** Build a URL stamp from response headers, keeping only useful validators. */
export function urlStampOf(url, headers) {
    const etag = headerOf(headers, 'etag');
    const lastModified = headerOf(headers, 'last-modified');
    const rawLength = headerOf(headers, 'content-length');
    const parsedLength = rawLength === undefined ? undefined : Number(rawLength);
    const contentLength = parsedLength !== undefined && Number.isFinite(parsedLength) && parsedLength >= 0
        ? parsedLength
        : undefined;
    return {
        kind: 'url',
        url: canonicalSourceUrl(url),
        ...(etag !== undefined ? { etag } : {}),
        ...(lastModified !== undefined ? { lastModified } : {}),
        ...(contentLength !== undefined ? { contentLength } : {}),
    };
}
/** Probe a URL with HEAD; a failed probe never validates stale text. */
async function probeUrl(url, maxBytes, client, signal) {
    const { headers, finalUrl } = await owned(() => client.head(canonicalSourceUrl(url), {
        method: 'HEAD',
        signal,
        maxBytes,
        timeoutMs: HEAD_TIMEOUT_MS,
    }), signal);
    return urlStampOf(finalUrl, headers);
}
/** Download a public URL PDF through the shared double gate, then validate. */
async function downloadUrl(url, maxBytes, client, signal) {
    const requestedUrl = canonicalSourceUrl(url);
    const { bytes, headers, finalUrl } = await owned(() => client.get(requestedUrl, {
        method: 'GET',
        signal,
        maxBytes,
        timeoutMs: SOURCE_TRANSFER_TIMEOUT_MS,
        headers: { accept: 'application/pdf, application/octet-stream;q=0.8' },
    }), signal);
    return {
        bytes: validatedPdfBytes(bytes, maxBytes),
        stamp: urlStampOf(finalUrl, headers),
        urlSource: { requestedUrl, finalUrl: canonicalSourceUrl(finalUrl) },
    };
}
/** Read a local attachment file from disk, refusing one over the cap. */
async function readLocalFile(path, maxBytes, deps, signal) {
    let info;
    try {
        info = await owned(() => deps.stat(path), signal);
    }
    catch (error) {
        signal?.throwIfAborted();
        refuse(`the attachment file is unreadable (${error.message})`);
    }
    if (info.size > maxBytes) {
        refuse(`the file is ${info.size} bytes, over the ${maxBytes}-byte limit`);
    }
    try {
        const bytes = validatedPdfBytes(await owned(() => deps.readFile(path, signal), signal), maxBytes);
        return { bytes, stamp: { kind: 'file', size: info.size, mtimeMs: info.mtimeMs } };
    }
    catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ZoteroError)
            throw error;
        refuse(`the attachment file could not be read (${error.message})`);
    }
}
/** Resolve one local attachment ref to bytes. */
async function localBytes(source, maxBytes, deps, signal) {
    const resolved = await owned(() => deps.resolveAttachment(source.attachmentRef, signal), signal);
    if (resolved.kind === 'file' && resolved.path !== undefined) {
        return await readLocalFile(resolved.path, maxBytes, deps, signal);
    }
    if (resolved.kind === 'url' && resolved.url !== undefined) {
        return await downloadUrl(resolved.url, maxBytes, deps.client, signal);
    }
    refuse('the attachment has neither a local file nor a public URL');
}
/**
 * Probe the source without reading the document. A caller-supplied stamp wins;
 * otherwise a local file is `stat`ed, a URL gets one HEAD, and supplied bytes
 * are hashed.
 */
export async function probeSource(input, maxBytes, deps, signal) {
    signal?.throwIfAborted();
    if (input.bytes !== undefined) {
        return { kind: 'bytes', fingerprint: sha256(input.bytes) };
    }
    if (input.sourceStamp !== undefined)
        return input.sourceStamp;
    const source = input.source;
    if (source.kind === 'url') {
        return await probeUrl(source.url, maxBytes, deps.client, signal);
    }
    // Target validation usually resolved the attachment already; reuse it so a
    // probe costs one resolution, not two.
    const resolved = input.resolvedAttachment ??
        (await owned(() => deps.resolveAttachment(source.attachmentRef, signal), signal));
    if (resolved.kind === 'file' && resolved.path !== undefined) {
        const path = resolved.path;
        const info = await owned(() => deps.stat(path), signal);
        if (info.size > maxBytes) {
            refuse(`the file is ${info.size} bytes, over the ${maxBytes}-byte limit`);
        }
        return { kind: 'file', size: info.size, mtimeMs: info.mtimeMs };
    }
    if (resolved.kind === 'url' && resolved.url !== undefined) {
        return await probeUrl(resolved.url, maxBytes, deps.client, signal);
    }
    refuse('the attachment has neither a local file nor a public URL');
}
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
export async function obtainSourceBytes(input, maxBytes, deps, signal) {
    signal?.throwIfAborted();
    if (input.bytes !== undefined) {
        const bytes = validatedPdfBytes(input.bytes, maxBytes);
        const stamp = { kind: 'bytes', fingerprint: sha256(bytes) };
        return { bytes, stamp };
    }
    if (input.source.kind === 'local') {
        return await localBytes(input.source, maxBytes, deps, signal);
    }
    return await downloadUrl(input.source.url, maxBytes, deps.client, signal);
}
/** Production deps: real disk reads plus the core's attachment resolver. */
export function hostSourceBytesDeps(resolveAttachment, client) {
    return {
        resolveAttachment,
        stat,
        readFile: async (path, signal) => new Uint8Array(await readFile(path, { signal })),
        client,
    };
}
//# sourceMappingURL=source-bytes.js.map