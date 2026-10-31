/**
 * The `zotero_retrieve` domain: one item's annotations, notes, abstract, and
 * full-text chunks ranked as a single BM25 passage corpus, with per-passage
 * attachment provenance under the multi-attachment policies. An annotation
 * ranks on its highlight and the reader's comment together, and reports which
 * of the two matched; notes, the abstract, and full-text chunks rank on their
 * own text.
 * @module dsh-zotero/local/retrieve
 */
import { mapWithConcurrency } from '../concurrency.js';
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_NO_FULLTEXT, ZoteroError } from '../errors.js';
import { chunkText, rankChunks, tokenize } from '../evidence.js';
import { asRecord, asString } from '../json.js';
import { selectAttachments, bestAttachmentFromLinks } from '../attachments.js';
import { formatRef, libraryPrefix, refStringFor, requireSupportedLocalRef, sameLibrary, } from '../refs.js';
import { assertServerIdMatches, serverIdFromHeaders } from './identity.js';
import { partitionChildren, } from '../normalize-children.js';
import { plainNoteText, truncateText } from '../normalize-context.js';
import { loadChildRows } from './detail.js';
import { attachmentFactOf, fetchFulltext, normalizeCoverage, readFulltextSources, } from './retrieve-fulltext.js';
/** The order `sourcesSkipped` reports in; stable regardless of the request order. */
const SOURCE_ORDER = ['annotation', 'note', 'abstract', 'fulltext'];
/**
 * The `best` policy's fulltext read: the linked attachment when Zotero names
 * one, else the first PDF child. An unindexed attachment degrades like an
 * absent one — the other requested sources still answer.
 */
async function readBestFulltext(deps, ref, serverId, linkAttachment, childrenRows, bestFulltextKey, fulltextPromise, signal) {
    const passages = [];
    let skippedFulltext = false;
    let fulltextWasCut = false;
    let attachmentRef;
    let attachmentContentType;
    let coverage;
    let attachmentKey = bestFulltextKey;
    // The link arm reports Zotero's own type (possibly empty); the child
    // fallback selects an application/pdf candidate whose type is known.
    let selectedContentType = linkAttachment?.contentType;
    if (attachmentKey === undefined) {
        const pdf = selectAttachments(childrenRows, 'pdf')[0];
        if (pdf === undefined)
            skippedFulltext = true;
        else {
            attachmentKey = pdf.key;
            selectedContentType = pdf.contentType;
        }
    }
    if (attachmentKey !== undefined) {
        try {
            attachmentRef = refStringFor(ref.library, 'attachment', attachmentKey, serverId);
            if (selectedContentType !== undefined && selectedContentType !== '') {
                attachmentContentType = selectedContentType;
            }
            const payload = await (fulltextPromise ??
                fetchFulltext(deps, attachmentKey, ref.library, serverId, signal));
            const content = typeof payload.content === 'string' ? payload.content : '';
            const bounded = truncateText(content, deps.limits.maxFulltextChars);
            fulltextWasCut = bounded.truncated;
            const chunks = chunkText(bounded.text, deps.limits.fulltextChunkWords, deps.limits.maxEvidenceChars);
            for (const chunk of chunks) {
                passages.push({
                    source: 'fulltext',
                    sourceRef: attachmentRef,
                    text: chunk.text,
                    chunkIndex: chunk.index,
                    chunkCount: chunks.length,
                });
            }
            coverage = normalizeCoverage(payload);
        }
        catch (error) {
            // An unindexed attachment degrades like an absent one: the other
            // requested sources still answer, and `sourcesSkipped` reports it.
            if (error instanceof ZoteroError && error.code === ZOTERO_NO_FULLTEXT) {
                skippedFulltext = true;
            }
            else {
                throw error;
            }
        }
    }
    return {
        skippedFulltext,
        fulltextWasCut,
        ...(attachmentRef !== undefined ? { attachmentRef } : {}),
        ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
        ...(coverage !== undefined ? { coverage } : {}),
        passages,
    };
}
/**
 * The multi-attachment policies' fulltext read: every selected PDF is a
 * first-class source, and each passage carries its own attachment provenance.
 */
async function readMultiAttachmentFulltext(deps, ref, serverId, prefix, policy, attachmentRefs, childrenRows, signal) {
    const passages = [];
    let skippedFulltext = false;
    let fulltextWasCut = false;
    let attachmentRef;
    let attachmentContentType;
    let coverage;
    let attachments;
    let candidates;
    if (policy === 'allIndexed') {
        candidates = selectAttachments(childrenRows, 'pdf').map((candidate) => ({
            key: candidate.key,
            contentType: candidate.contentType,
        }));
    }
    else {
        // One attachment contributes once: the same text entering the corpus
        // twice would read as two sources agreeing with each other. The set is
        // taken before the cap so a list that repeats one ref is not rejected
        // as if it named many.
        const distinct = new Map();
        for (const attachmentRef of attachmentRefs) {
            const identity = formatRef(attachmentRef);
            if (!distinct.has(identity))
                distinct.set(identity, attachmentRef);
        }
        if (distinct.size > deps.limits.retrieveAttachmentCap) {
            throw new ZoteroError(`attachmentRefs lists ${distinct.size} attachments; at most ${deps.limits.retrieveAttachmentCap} can enter one ranking; split the work across calls.`, ZOTERO_INVALID_ARGUMENT);
        }
        candidates = await mapWithConcurrency([...distinct.values()], deps.limits.graphConcurrency, async (wanted, poolSignal) => {
            // The ref is a claim about where this text comes from. Reading a
            // same-key object out of the wrong library or the wrong database
            // would attach a stranger's words to this item, so the claim is
            // checked against the ref itself before any read, and against the
            // object's own answer after it.
            if (!sameLibrary(wanted.library, ref.library)) {
                throw new ZoteroError(`Attachment ref ${wanted.key} belongs to library ${wanted.library.type}/${wanted.library.id}, not to ${ref.library.type}/${ref.library.id}. Full text entering this item's evidence must come from this item's own library.`, ZOTERO_INVALID_ARGUMENT);
            }
            assertServerIdMatches(wanted.serverId, serverId);
            const row = await deps.client.getJson(`${prefix}/items/${wanted.key}`, undefined, {
                signal: poolSignal,
                serverId,
            });
            const rowData = asRecord(asRecord(row.json)?.data);
            const rowType = asString(rowData?.itemType);
            const parentKey = asString(rowData?.parentItem);
            if (rowType !== 'attachment') {
                throw new ZoteroError(rowType === undefined
                    ? `Attachment ref ${wanted.key} cannot be proven an attachment: Zotero's answer named no item type for it, so nothing rules out a bibliographic item. Read the item's children with zotero_children and name an attachment ref from there.`
                    : `Attachment ref ${wanted.key} names a ${rowType}, not an attachment.`, ZOTERO_INVALID_ARGUMENT);
            }
            if (parentKey !== ref.key) {
                throw new ZoteroError(parentKey === undefined
                    ? `Attachment ref ${wanted.key} is a top-level attachment with no parent item, so its text is not evidence for ${ref.key}.`
                    : `Attachment ref ${wanted.key} is attached to item ${parentKey}, not to ${ref.key}; its text would be another work's evidence. Read this item's children with zotero_children to get refs that belong to it.`, ZOTERO_INVALID_ARGUMENT);
            }
            return { key: wanted.key, contentType: asString(rowData?.contentType) };
        }, { signal });
    }
    // An `allIndexed` selection can repeat a key only if the listing did; the
    // set is taken for both policies so no attachment enters the corpus twice.
    const unique = new Map();
    for (const candidate of candidates) {
        if (!unique.has(candidate.key))
            unique.set(candidate.key, candidate);
    }
    candidates = [...unique.values()];
    if (candidates.length === 0) {
        skippedFulltext = true;
    }
    else {
        const sources = await readFulltextSources(deps, ref, serverId, candidates, signal);
        const indexed = sources.filter((source) => source.status === 'indexed');
        if (indexed.length === 0)
            skippedFulltext = true;
        for (const source of indexed) {
            const passageAttachmentRef = refStringFor(ref.library, 'attachment', source.key, serverId);
            fulltextWasCut = fulltextWasCut || source.inputTruncated;
            for (const chunk of source.chunks) {
                passages.push({
                    source: 'fulltext',
                    sourceRef: passageAttachmentRef,
                    text: chunk.text,
                    chunkIndex: chunk.index,
                    chunkCount: source.chunks.length,
                });
            }
        }
        attachments = sources.map((source) => ({
            ref: refStringFor(ref.library, 'attachment', source.key, serverId),
            ...(source.contentType === undefined || source.contentType === ''
                ? {}
                : { contentType: source.contentType }),
            ...attachmentFactOf(source),
        }));
        // Result-level provenance stays unambiguous: with exactly one
        // contributing attachment it names that file; with several, the
        // per-passage refs carry the mapping.
        if (indexed.length === 1) {
            const source = indexed[0];
            attachmentRef = refStringFor(ref.library, 'attachment', source.key, serverId);
            if (source.contentType !== undefined && source.contentType !== '') {
                attachmentContentType = source.contentType;
            }
            coverage = source.coverage;
        }
    }
    return {
        skippedFulltext,
        fulltextWasCut,
        ...(attachmentRef !== undefined ? { attachmentRef } : {}),
        ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
        ...(coverage !== undefined ? { coverage } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        passages,
    };
}
export async function retrieve(deps, request, signal) {
    const policy = request.attachmentPolicy ?? 'best';
    if (policy === 'specified' && (request.attachmentRefs?.length ?? 0) === 0) {
        throw new ZoteroError('attachmentPolicy "specified" requires at least one attachmentRef.', ZOTERO_INVALID_ARGUMENT);
    }
    const ref = requireSupportedLocalRef(request.ref, ['item']);
    const prefix = libraryPrefix(ref.library);
    const parent = await deps.client.getJson(`${prefix}/items/${ref.key}`, undefined, {
        signal,
        serverId: ref.serverId,
    });
    const serverId = serverIdFromHeaders(parent.headers, ref.serverId);
    const record = asRecord(parent.json);
    const data = asRecord(record?.data);
    const itemType = asString(data?.itemType) ?? asString(record?.itemType);
    const linkAttachment = bestAttachmentFromLinks(parent.json);
    const wantsAnnotations = request.sources.includes('annotation');
    const wantsNotes = request.sources.includes('note');
    const wantsFulltext = request.sources.includes('fulltext');
    // A note item's own body is its note source, so its children are only
    // needed for annotation sources, the PDF fallback, or an allIndexed scan.
    const isNoteItem = itemType === 'note';
    const needsChildrenForFulltext = wantsFulltext &&
        (policy === 'allIndexed' || (policy === 'best' && linkAttachment === undefined));
    const fetchChildren = wantsAnnotations || (wantsNotes && !isNoteItem) || needsChildrenForFulltext;
    // Children and a linked fulltext are independent once the parent has
    // arrived; start both before awaiting either. The noop handler keeps a
    // fulltext rejection that lands while children are still in flight from
    // being reported as unhandled before the try below awaits it.
    const bestFulltextKey = wantsFulltext && policy === 'best' ? linkAttachment?.key : undefined;
    const fulltextPromise = bestFulltextKey === undefined
        ? undefined
        : fetchFulltext(deps, bestFulltextKey, ref.library, serverId, signal);
    fulltextPromise?.catch(() => { });
    let childrenRows = [];
    if (fetchChildren) {
        childrenRows = (await loadChildRows(deps, ref.key, ref.library, serverId, signal, {
            // Full-text fallback and note sources still read the bare listing;
            // annotations ride their own filtered contract.
            direct: true,
            annotations: wantsAnnotations,
        })).rows;
    }
    const skipped = [];
    let fulltextWasCut = false;
    let attachmentRef;
    let attachmentContentType;
    let coverage;
    let attachments;
    const passages = [];
    let fulltext;
    if (wantsFulltext && policy === 'best') {
        fulltext = await readBestFulltext(deps, ref, serverId, linkAttachment, childrenRows, bestFulltextKey, fulltextPromise, signal);
    }
    else if (wantsFulltext && policy !== 'best') {
        fulltext = await readMultiAttachmentFulltext(deps, ref, serverId, prefix, policy, request.attachmentRefs ?? [], childrenRows, signal);
    }
    if (fulltext !== undefined) {
        if (fulltext.skippedFulltext)
            skipped.push('fulltext');
        fulltextWasCut = fulltext.fulltextWasCut;
        attachmentRef = fulltext.attachmentRef;
        attachmentContentType = fulltext.attachmentContentType;
        coverage = fulltext.coverage;
        attachments = fulltext.attachments;
        passages.push(...fulltext.passages);
    }
    const partitioned = fetchChildren
        ? partitionChildren(childrenRows, { library: ref.library, serverId }, undefined, new Set([
            ...(wantsNotes ? ['note'] : []),
            ...(wantsAnnotations ? ['annotation'] : []),
        ]))
        : { notes: [], annotations: [], attachments: [] };
    if (wantsAnnotations) {
        if (partitioned.annotations.length === 0)
            skipped.push('annotation');
        for (const annotation of partitioned.annotations) {
            passages.push({
                source: 'annotation',
                sourceRef: annotation.ref,
                text: annotation.text,
                ...(annotation.comment !== undefined ? { comment: annotation.comment } : {}),
                ...(annotation.pageLabel !== undefined ? { pageLabel: annotation.pageLabel } : {}),
                ...(annotation.parentRef === undefined ? {} : { attachmentRef: annotation.parentRef }),
                // A reader's comment is part of what the annotation says about the
                // paper ("the method looks biased here" is a finding in its own
                // right, and a highlight whose words say nothing about it must still
                // be findable by the comment's terms). Both fields rank; the evidence
                // keeps them apart and names the one that matched.
                ...(annotation.comment === undefined
                    ? {}
                    : { rankText: `${annotation.text}\n${annotation.comment}` }),
            });
        }
    }
    if (wantsNotes) {
        const noteRef = refStringFor(ref.library, 'item', ref.key, serverId);
        const noteSources = isNoteItem
            ? [{ ref: noteRef, text: plainNoteText(data?.note) }]
            : partitioned.notes.map((note) => ({ ref: note.ref, text: note.text }));
        // A note item's own body is its note source, so only a non-note item
        // without child notes cannot provide the source.
        if (!isNoteItem && partitioned.notes.length === 0)
            skipped.push('note');
        for (const note of noteSources) {
            const chunks = chunkText(note.text, deps.limits.fulltextChunkWords, deps.limits.maxEvidenceChars);
            for (const chunk of chunks) {
                passages.push({
                    source: 'note',
                    sourceRef: note.ref,
                    text: chunk.text,
                    chunkIndex: chunk.index,
                    chunkCount: chunks.length,
                });
            }
        }
    }
    let abstractWasCut = false;
    if (request.sources.includes('abstract')) {
        const raw = asString(data?.abstractNote) ?? '';
        if (raw !== '') {
            const bounded = truncateText(raw, deps.limits.maxEvidenceChars);
            abstractWasCut = bounded.truncated;
            passages.push({
                source: 'abstract',
                sourceRef: refStringFor(ref.library, 'item', ref.key, serverId),
                text: bounded.text,
            });
        }
        else {
            skipped.push('abstract');
        }
    }
    const ranked = rankChunks(request.query, passages.map((passage, index) => ({ text: passage.rankText ?? passage.text, index })));
    // Zero-score passages share nothing with the query; returning them as
    // "evidence" would present arbitrary excerpts as matches. A query with no
    // token overlap therefore yields an empty evidence array, which the
    // contract reads as "no match", not "no content".
    const matched = ranked.filter((entry) => entry.score > 0);
    const queryTerms = new Set(tokenize(request.query));
    const evidence = [];
    let used = 0;
    let truncated = matched.length > request.passages || fulltextWasCut || abstractWasCut;
    for (const entry of matched.slice(0, request.passages)) {
        const passage = passages[entry.index];
        // The budget charges every character the passage puts in front of the
        // model: the text and, for an annotation, its comment. Charging only the
        // text let a long comment ride in above the configured bound.
        const charged = passage.text.length + (passage.comment?.length ?? 0);
        if (used + charged > deps.limits.maxEvidenceChars) {
            truncated = true;
            break;
        }
        used += charged;
        const matchedFields = matchedFieldsOf(queryTerms, passage);
        evidence.push({
            source: passage.source,
            sourceRef: passage.sourceRef,
            text: passage.text,
            ...(passage.chunkIndex !== undefined ? { chunkIndex: passage.chunkIndex } : {}),
            ...(passage.chunkCount !== undefined ? { chunkCount: passage.chunkCount } : {}),
            ...(passage.comment !== undefined ? { comment: passage.comment } : {}),
            ...(passage.pageLabel !== undefined ? { pageLabel: passage.pageLabel } : {}),
            ...(passage.attachmentRef !== undefined ? { attachmentRef: passage.attachmentRef } : {}),
            ...(matchedFields !== undefined ? { matchedFields } : {}),
        });
    }
    // A stable report order keeps the contract predictable: the sources the
    // caller asked for but the item could not provide, deduplicated.
    const sourcesSkipped = [...new Set(skipped)].sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
    return {
        ref: refStringFor(ref.library, 'item', ref.key, serverId),
        ...(attachmentRef !== undefined ? { attachmentRef } : {}),
        ...(attachmentContentType !== undefined ? { attachmentContentType } : {}),
        ...(coverage !== undefined ? { coverage } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
        evidence,
        truncated,
        sourcesSkipped,
    };
}
/**
 * Which of a passage's ranked fields carry query terms. An annotation is the
 * only two-field source (the highlight a reader selected and the comment
 * they wrote), and the comment is the reader's own view rather than the
 * paper's, so the evidence names the field that matched. A ranked passage
 * always matched somewhere (`score > 0` means a query term sits in its
 * text-or-comment token stream, and a single field's tokens are a subset of
 * that stream), so the returned list is never empty.
 */
function matchedFieldsOf(queryTerms, passage) {
    if (passage.comment === undefined)
        return undefined;
    const fields = [];
    if (carriesQueryTerm(queryTerms, passage.text))
        fields.push('text');
    if (carriesQueryTerm(queryTerms, passage.comment))
        fields.push('comment');
    return fields;
}
/** Whether any query term appears in a field's own tokens. */
function carriesQueryTerm(queryTerms, text) {
    return tokenize(text).some((term) => queryTerms.has(term));
}
//# sourceMappingURL=retrieve.js.map