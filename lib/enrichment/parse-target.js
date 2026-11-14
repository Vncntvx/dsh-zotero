/** Explicit parsing targets and safe, bounded presentation at the enrichment boundary. */
import { createHash } from 'node:crypto';
import { ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT, ZOTERO_INVALID_ARGUMENT, ZOTERO_SERVER_MISMATCH, ZoteroError, } from '../errors.js';
import { formatRef, parseSupportedRef, sameLibrary } from '../refs.js';
import { isPublicUrl } from '../transport/public-url.js';
import { zoteroParseTargetSchema } from '../wire-schemas.js';
export function parseDigest(value) {
    return createHash('sha256').update(value).digest('hex');
}
/** Receipt and progress text never retain URLs, absolute paths, or credential assignments. */
export function safeParseText(value, limit) {
    return value
        .replace(/(?:https?|file):\/\/[^\s<>"')\]]+/gi, '[URL]')
        .replace(/\b(?:bearer\s+|(?:token|api[_-]?key|authorization|password|secret)\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, '[credential]')
        .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"')\]]+/g, '[path]')
        .replace(/(^|[\s("'=`])\/(?:[^\s/]+\/)*[^\s<>"')\]`]*/g, '$1[path]')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .slice(0, limit);
}
function publicPdfUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new ZoteroError('Select a public HTTP(S) PDF URL.', ZOTERO_INVALID_ARGUMENT);
    }
    if (url.username || url.password || !isPublicUrl(url.href)) {
        throw new ZoteroError('Select a public HTTP(S) PDF URL.', ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT);
    }
    url.hash = '';
    return url.href;
}
/** Pure validation, safe before registry admission. No source probe occurs here. */
export function parseTargetOf(value) {
    const parsed = zoteroParseTargetSchema.safeParse(value);
    if (!parsed.success) {
        throw new ZoteroError('Invalid document parsing target.', ZOTERO_INVALID_ARGUMENT);
    }
    const target = parsed.data;
    // An artifact id is an opaque handle, not a source. expandRequestTarget
    // must resolve it to a concrete attachment/URL target before this point.
    if (target.kind === 'artifact') {
        throw new ZoteroError('A parsed artifact id must be resolved before parsing.', ZOTERO_INVALID_ARGUMENT);
    }
    if (target.kind === 'url') {
        const url = publicPdfUrl(target.url);
        return {
            target: { kind: 'url', url },
            input: { key: url, source: { kind: 'url', url }, contentType: 'application/pdf' },
            sourceId: parseDigest(url),
            // Even the URL path can contain signed credentials. Display only its origin.
            targetLabel: `${new URL(url).origin}/…`,
        };
    }
    const ref = formatRef(parseSupportedRef(target.ref, ['attachment']));
    return {
        target: { kind: 'attachment', ref },
        input: {
            key: ref,
            source: { kind: 'local', attachmentRef: ref },
            contentType: 'application/pdf',
        },
        sourceId: parseDigest(ref),
        targetLabel: `Zotero PDF ${parseSupportedRef(ref).key}`,
    };
}
/**
 * Resolve exactly the selected attachment, including top-level attachments.
 * The trusted core checks the live server; this boundary also checks that its
 * response still names the selected key, library, instance, and PDF type.
 */
export async function resolveParseTarget(target, resolveAttachment, signal) {
    signal.throwIfAborted();
    if (target.target.kind === 'url')
        return target;
    if (target.target.kind !== 'attachment') {
        // parseTargetOf rejects artifact ids; this keeps the invariant local.
        throw new ZoteroError('Invalid document parsing target.', ZOTERO_INVALID_ARGUMENT);
    }
    const requested = parseSupportedRef(target.target.ref, ['attachment']);
    const resolved = await resolveAttachment(target.target.ref, signal);
    signal.throwIfAborted();
    const actual = parseSupportedRef(resolved.ref, ['attachment']);
    if (!sameLibrary(requested.library, actual.library) || requested.key !== actual.key) {
        throw new ZoteroError('The resolved attachment differs from the selected PDF.', ZOTERO_INVALID_ARGUMENT);
    }
    if (requested.serverId !== undefined && requested.serverId !== actual.serverId) {
        throw new ZoteroError('The selected PDF belongs to a different Zotero instance.', ZOTERO_SERVER_MISMATCH);
    }
    if (resolved.contentType.split(';')[0]?.trim().toLowerCase() !== 'application/pdf') {
        throw new ZoteroError('The selected attachment is not a PDF.', ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT);
    }
    if (resolved.kind === 'url') {
        if (resolved.url === undefined) {
            throw new ZoteroError('The selected PDF has no public URL.', ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT);
        }
        publicPdfUrl(resolved.url);
    }
    else if (resolved.kind !== 'file' || !resolved.path) {
        throw new ZoteroError('The selected PDF has no readable source.', ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT);
    }
    const ref = formatRef(actual);
    return {
        ...target,
        input: {
            key: ref,
            source: { kind: 'local', attachmentRef: ref },
            contentType: 'application/pdf',
            resolvedAttachment: resolved,
        },
        sourceId: parseDigest(ref),
        targetLabel: safeParseText(resolved.title, 2048).trim() || target.targetLabel,
    };
}
//# sourceMappingURL=parse-target.js.map