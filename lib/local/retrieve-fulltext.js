import { fulltextIdentityOf } from './fulltext-identity.js';
/**
 * @module dsh-zotero/local/retrieve-fulltext
 */
import { createHash } from 'node:crypto';
import { mapWithConcurrency } from '../concurrency.js';
import { isNotFoundError, NO_FULLTEXT_MESSAGE, ZOTERO_CAPABILITY_UNAVAILABLE, ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND, ZOTERO_INVALID_ARGUMENT, ZOTERO_NO_FULLTEXT, ZOTERO_SOURCE_PAGE_STALE, ZOTERO_UNEXPECTED, ZoteroError, } from '../errors.js';
import { chunkText } from '../evidence.js';
import { formatRef, libraryPrefix, parseSupportedRef, refStringFor } from '../refs.js';
import { truncateText } from '../normalize-context.js';
import { asRecord, detachUtf16 } from '../json.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { isPdfCandidateContentType, } from './fulltext-enhancer.js';
export { isPdfCandidateContentType } from './fulltext-enhancer.js';
/**
 * Reuse a valid parsed artifact for one PDF. A missing artifact returns
 * `undefined` so the caller reads Zotero's index; storage faults propagate.
 */
export async function lookupParsedFulltext(deps, input, signal) {
    if (deps.enhancer === undefined)
        return undefined;
    const outcome = await deps.enhancer.lookup(input, signal);
    if (outcome.kind === 'hit')
        return outcome;
    if (outcome.kind === 'fault')
        throw outcome.error;
    return undefined;
}
/**
 * Read one attachment's full text: a valid parsed artifact carries its own
 * format and immutable provenance; a miss falls back to Zotero's index text,
 * and only an absent index is unindexed. A non-PDF candidate never asks the
 * enhancer — the artifact store holds parsed PDFs, so asking it for anything
 * else would spend a lookup the caller knows is doomed. Artifact faults
 * propagate even when their code happens to name an index condition.
 */
async function readOneFulltext(deps, source, signal) {
    if (isPdfCandidateContentType(source.contentType) && deps.enhancer !== undefined) {
        const parsed = await lookupParsedFulltext(deps, {
            key: source.attachmentRef,
            source: { kind: 'local', attachmentRef: source.attachmentRef },
            ...(source.contentType === undefined ? {} : { contentType: source.contentType }),
        }, signal);
        if (parsed !== undefined) {
            return {
                status: 'indexed',
                text: parsed.text,
                textFormat: parsed.format,
                artifact: parsed.provenance,
            };
        }
    }
    let payload;
    try {
        payload = await fetchFulltext(deps, source.key, source.library, source.serverId, signal);
    }
    catch (error) {
        if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
            return { status: 'unindexed' };
        }
        throw error;
    }
    const content = typeof payload.content === 'string' ? payload.content : '';
    return {
        status: 'indexed',
        text: content,
        textFormat: 'text',
        coverage: normalizeCoverage(payload),
    };
}
/** Read one document's complete text in source order. */
export async function readFulltextDocument(deps, source, signal) {
    if (source.kind === 'artifactId') {
        const outcome = deps.enhancer?.lookupArtifact
            ? await deps.enhancer.lookupArtifact(source.artifactId, signal)
            : undefined;
        if (outcome === undefined) {
            throw new ZoteroError('Reading a parsed artifact requires the dsh-zotero/enrichment component.', ZOTERO_CAPABILITY_UNAVAILABLE);
        }
        if (outcome.kind === 'fault')
            throw outcome.error;
        if (outcome.kind === 'miss') {
            throw new ZoteroError('The parsed artifact is not available.', ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND);
        }
        if (outcome.sourceKind === 'attachment' && outcome.attachmentRef === undefined)
            throw new ZoteroError('The parsed attachment artifact has no attachment identity.', ZOTERO_UNEXPECTED);
        const { serverId: _serverId, ...identity } = outcome.attachmentRef === undefined
            ? { serverId: undefined }
            : await fulltextIdentityOf(deps.client, outcome.attachmentRef, signal);
        return {
            text: outcome.text,
            textFormat: outcome.format,
            sourceKind: outcome.sourceKind,
            sourceLabel: outcome.sourceLabel,
            artifact: outcome.provenance,
            ...identity,
        };
    }
    const ref = parseSupportedRef(source.ref, ['attachment']);
    const { serverId, ...identity } = await fulltextIdentityOf(deps.client, formatRef(ref), signal);
    const { attachmentRef, attachmentContentType } = identity;
    // The shared single-source kernel: artifact first (PDF candidates only),
    // then Zotero's index text. A missing artifact and an unindexed source are
    // the same answer here — the complete read has nothing to fall back to.
    const outcome = await readOneFulltext(deps, {
        key: ref.key,
        attachmentRef,
        library: ref.library,
        serverId,
        contentType: attachmentContentType,
    }, signal);
    if (outcome.status === 'unindexed') {
        throw new ZoteroError(NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT);
    }
    return {
        text: outcome.text,
        textFormat: outcome.textFormat,
        sourceKind: 'attachment',
        sourceLabel: attachmentRef,
        ...(outcome.artifact === undefined ? {} : { artifact: outcome.artifact }),
        ...(outcome.coverage === undefined ? {} : { coverage: outcome.coverage }),
        ...identity,
    };
}
/**
 * Apply the call's input bound, then take a UTF-16 window without splitting a surrogate pair.
 * Consecutive windows remain losslessly joinable through
 * `nextStart`. The bounded whole text rides out with the window so the caller
 * can offer a one-handle copy without re-truncating.
 */
export function fulltextWindowOf(document, start, maxChars, maxFulltextChars) {
    const bounded = truncateText(document.text, maxFulltextChars);
    const totalChars = bounded.text.length;
    if (Math.floor(start) > totalChars || start < 0) {
        throw new ZoteroError(`start must name a character within the document (0..${totalChars}).`, ZOTERO_INVALID_ARGUMENT);
    }
    const offset = Math.min(Math.floor(start), totalChars);
    if (offset > 0 &&
        /[\uDC00-\uDFFF]/.test(bounded.text[offset]) &&
        /[\uD800-\uDBFF]/.test(bounded.text[offset - 1])) {
        throw new ZoteroError('start must not split a UTF-16 surrogate pair.', ZOTERO_INVALID_ARGUMENT);
    }
    let end = Math.min(totalChars, offset + Math.max(1, Math.floor(maxChars)));
    if (end < totalChars &&
        /[\uD800-\uDBFF]/.test(bounded.text[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(bounded.text[end])) {
        // A one-code-unit window beginning with a pair must still advance.
        end += end - offset === 1 ? 1 : -1;
    }
    const isTruncated = end < totalChars;
    const read = {
        sourceKind: document.sourceKind,
        ...(document.item === undefined ? {} : { item: document.item }),
        ...(document.attachmentContentType === undefined
            ? {}
            : { attachmentContentType: document.attachmentContentType }),
        sourceLabel: document.sourceLabel,
        textFormat: document.textFormat,
        ...(document.artifact === undefined ? {} : { artifact: document.artifact }),
        ...(document.coverage === undefined ? {} : { coverage: document.coverage }),
        totalChars,
        inputTruncated: bounded.truncated,
        start: offset,
        end,
        // The window detaches from the body it was cut from: it rides the tool
        // result and the ledger, and a live slice would pin the whole document.
        text: detachUtf16(bounded.text.slice(offset, end)),
        isTruncated,
        ...(isTruncated ? { nextStart: end } : {}),
        ...(document.attachmentRef === undefined ? {} : { attachmentRef: document.attachmentRef }),
    };
    return { read, boundedText: bounded.text };
}
/** The message when a continuation window arrives without its token. */
export const FULLTEXT_CONTINUATION_REQUIRED_MESSAGE = 'start > 0 requires the continuation token returned with the previous window; restart at start=0.';
/** The message when the token cannot describe this read. */
const FULLTEXT_CONTINUATION_INVALID_MESSAGE = 'The continuation token is malformed; discard the earlier windows and restart at start=0.';
/** The message when the document changed between two windows. */
export const FULLTEXT_CONTINUATION_CHANGED_MESSAGE = 'The document changed between read windows, so the windows would come from different versions. Discard the earlier text and restart at start=0.';
/**
 * The identity a continuation chain is bound to: the stored artifact, the
 * Zotero attachment, or the URL origin. A chain may not switch sources even
 * when the text hashes agree, because provenance and coverage would mix.
 */
function fulltextSourceIdentityOf(document) {
    if (document.artifact !== undefined)
        return `artifact:${document.artifact.artifactId}`;
    if (document.attachmentRef !== undefined)
        return `attachment:${document.attachmentRef}`;
    return `source:${document.sourceKind}:${document.sourceLabel}`;
}
/** The parsed-artifact version facts a continuation is bound to. */
function fulltextArtifactIdentityOf(document) {
    return document.artifact === undefined
        ? null
        : { fingerprint: document.artifact.fingerprint, generation: document.artifact.generation };
}
function fulltextDigestOf(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
/**
 * Generates a stateless continuation token for a bounded document, binding
 * source identity, artifact generation, bounded length, and text SHA-256
 * across consecutive window reads.
 */
export function fulltextContinuationOf(document, boundedText) {
    return Buffer.from(JSON.stringify({
        v: 1,
        source: fulltextSourceIdentityOf(document),
        artifact: fulltextArtifactIdentityOf(document),
        totalChars: boundedText.length,
        sha256: fulltextDigestOf(boundedText),
    }), 'utf8').toString('base64url');
}
/**
 * Validates a continuation token against the document's current source,
 * artifact generation, bounded length, and content digest.
 */
export function assertFulltextContinuation(document, boundedText, token) {
    if (token.length > 4_096)
        throw new ZoteroError(FULLTEXT_CONTINUATION_INVALID_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    }
    catch {
        throw new ZoteroError(FULLTEXT_CONTINUATION_INVALID_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    }
    const record = asRecord(parsed);
    if (record?.v !== 1 ||
        typeof record.source !== 'string' ||
        typeof record.totalChars !== 'number' ||
        typeof record.sha256 !== 'string' ||
        record.artifact === undefined)
        throw new ZoteroError(FULLTEXT_CONTINUATION_INVALID_MESSAGE, ZOTERO_INVALID_ARGUMENT);
    const expectedArtifact = fulltextArtifactIdentityOf(document);
    const savedArtifact = record.artifact === null ? undefined : asRecord(record.artifact);
    const artifactMatches = expectedArtifact === null
        ? record.artifact === null
        : savedArtifact !== undefined &&
            savedArtifact.fingerprint === expectedArtifact.fingerprint &&
            savedArtifact.generation === expectedArtifact.generation;
    if (record.source !== fulltextSourceIdentityOf(document) ||
        !artifactMatches ||
        record.totalChars !== boundedText.length ||
        record.sha256 !== fulltextDigestOf(boundedText))
        throw new ZoteroError(FULLTEXT_CONTINUATION_CHANGED_MESSAGE, ZOTERO_SOURCE_PAGE_STALE);
}
/** Cut enhanced or index text to a per-source budget and chunk it. */
export function chunkFulltext(text, perSourceChars, limits) {
    const bounded = truncateText(text, perSourceChars);
    return {
        inputTruncated: bounded.truncated,
        chunks: chunkText(bounded.text, limits.fulltextChunkWords, limits.maxEvidenceChars),
    };
}
/**
 * Full-text indexing coverage as reported by Zotero. `complete` is derived
 * per axis: the chars axis (text files) and the pages axis (PDFs) each count
 * as complete when the server reports both sides and they agree; the overall
 * answer is complete when at least one axis is reportable and every
 * reportable axis agrees. Anything else is an incomplete answer, never a
 * guess, so a full PDF index without char counts still reads complete.
 */
export function normalizeCoverage(payload) {
    const indexedChars = typeof payload.indexedChars === 'number' ? payload.indexedChars : undefined;
    const totalChars = typeof payload.totalChars === 'number' ? payload.totalChars : undefined;
    const indexedPages = typeof payload.indexedPages === 'number' ? payload.indexedPages : undefined;
    const totalPages = typeof payload.totalPages === 'number' ? payload.totalPages : undefined;
    const charsComplete = indexedChars !== undefined && totalChars !== undefined ? indexedChars === totalChars : undefined;
    const pagesComplete = indexedPages !== undefined && totalPages !== undefined ? indexedPages === totalPages : undefined;
    const axes = [charsComplete, pagesComplete].filter((value) => value !== undefined);
    return {
        ...(indexedPages !== undefined ? { indexedPages } : {}),
        ...(totalPages !== undefined ? { totalPages } : {}),
        ...(indexedChars !== undefined ? { indexedChars } : {}),
        ...(totalChars !== undefined ? { totalChars } : {}),
        complete: axes.length > 0 && axes.every((value) => value),
    };
}
/**
 * The per-source fact a result reports for one considered attachment: an
 * indexed source carries what it gave, the others carry only their status,
 * which is itself the finding ("Zotero's index has no text for this file" /
 * "this call did not read it").
 */
export function attachmentFactOf(source) {
    if (source.status !== 'indexed')
        return { status: source.status };
    return {
        status: 'indexed',
        textFormat: source.textFormat,
        ...(source.artifact === undefined ? {} : { artifact: source.artifact }),
        ...(source.coverage === undefined ? {} : { coverage: source.coverage }),
        inputTruncated: source.inputTruncated,
        passages: source.chunks.length,
    };
}
/**
 * Read every candidate attachment's full text and cut each one to its share
 * of the call's input budget.
 *
 * Three bounds meet here, all of them about the call rather than the work:
 * at most the configured `retrieveAttachmentCap` attachments are read at all
 * (the rest report `unread` instead of silently vanishing), the whole call
 * accepts at most `maxFulltextChars` code units, shared among sources with text.
 * Short sources return unused quota to longer ones. If the budget is below
 * the number of contributors, some receive zero characters. Allocation uses
 * length and candidate order, independent of read completion order. Workers
 * retain only a bounded prefix per source until chunking.
 */
export async function readFulltextSources(deps, ref, serverId, candidates, signal) {
    const read = candidates.slice(0, deps.limits.retrieveAttachmentCap);
    const loaded = await mapWithConcurrency(read, deps.limits.graphConcurrency, async (candidate, poolSignal) => {
        const base = {
            key: candidate.key,
            ...(candidate.contentType !== undefined ? { contentType: candidate.contentType } : {}),
        };
        const attachmentRef = refStringFor(ref.library, 'attachment', candidate.key, serverId);
        const outcome = await readOneFulltext(deps, {
            key: candidate.key,
            attachmentRef,
            library: ref.library,
            serverId,
            ...(candidate.contentType === undefined ? {} : { contentType: candidate.contentType }),
        }, poolSignal);
        if (outcome.status === 'unindexed')
            return { ...base, outcome, inputTruncated: false };
        const bounded = truncateText(outcome.text, deps.limits.maxFulltextChars);
        return {
            ...base,
            outcome: { ...outcome, text: bounded.text },
            inputTruncated: bounded.truncated,
        };
    }, { signal });
    const quotas = new Map();
    const contributors = loaded
        .flatMap((source, index) => source.outcome.status === 'indexed' && source.outcome.text.length > 0
        ? [{ index, length: source.outcome.text.length }]
        : [])
        .sort((a, b) => a.length - b.length || a.index - b.index);
    let remaining = deps.limits.maxFulltextChars;
    for (let index = 0; index < contributors.length; index++) {
        const source = contributors[index];
        const quota = Math.min(source.length, Math.floor(remaining / (contributors.length - index)));
        quotas.set(source.index, quota);
        remaining -= quota;
    }
    const results = loaded.map((source, index) => {
        const { outcome, key, contentType } = source;
        const base = { key, ...(contentType === undefined ? {} : { contentType }) };
        if (outcome.status === 'unindexed')
            return { ...base, status: 'unindexed' };
        const chunked = chunkFulltext(outcome.text, quotas.get(index) ?? 0, deps.limits);
        return {
            ...base,
            status: 'indexed',
            textFormat: outcome.textFormat,
            ...(outcome.artifact === undefined ? {} : { artifact: outcome.artifact }),
            ...(outcome.coverage === undefined ? {} : { coverage: outcome.coverage }),
            inputTruncated: source.inputTruncated === true || chunked.inputTruncated,
            chunks: chunked.chunks,
        };
    });
    return [
        ...results,
        ...candidates.slice(deps.limits.retrieveAttachmentCap).map((candidate) => ({
            key: candidate.key,
            ...(candidate.contentType !== undefined ? { contentType: candidate.contentType } : {}),
            status: 'unread',
        })),
    ];
}
export async function fetchFulltext(deps, attachmentKey, library, serverId, signal) {
    try {
        const response = await deps.client.getJson(`${libraryPrefix(library)}/items/${attachmentKey}/fulltext`, undefined, { signal, serverId, sendServerId: false });
        assertServerIdMatches(serverIdFromHeaders(response.headers, serverId), serverId);
        return response.json;
    }
    catch (error) {
        if (isNotFoundError(error)) {
            throw new ZoteroError(NO_FULLTEXT_MESSAGE, ZOTERO_NO_FULLTEXT);
        }
        throw error;
    }
}
//# sourceMappingURL=retrieve-fulltext.js.map