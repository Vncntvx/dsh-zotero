/**
 * The `zotero_retrieve` tool: gather evidence passages for one item and
 * rank them against a query. Annotations, notes, the abstract, and
 * full-text chunks compete in one ranked passage corpus; each passage reports
 * why it was returned (`matchKind`) so a meaning-level hit is never presented
 * as wording the source contains. The result is capped by passage count and
 * character budget with a `truncated` flag instead of mid-passage edits.
 * Full-text passages never carry invented page locators; only annotations keep
 * Zotero's own page label.
 * @module dsh-zotero/tools/retrieve
 */
import { defineZoteroTool as defineTool } from '../define-tool.js';
import { ZOTERO_MAX_QUERY_VARIANTS } from '../constants.js';
import { artifactIdOf } from '../contract.js';
import { invalidArgs } from '../errors.js';
import { requireEvidenceQueryWithinLimit } from '../evidence-query.js';
import { formatRef, parseSupportedRef, sameLibrary } from '../refs.js';
import { queryVariantsOf } from './query-variants.js';
import { boundedPresentationMeta, projectRetrieveMeta } from '../presentation-meta.js';
import { identityToolWrapper } from '../result-delivery.js';
import { metaRecordOf } from './present.js';
import { assertIntInRange, assertNonEmptyList, REF_ARG_HINT } from './validate.js';
import { exceedsInlineTokenBudget, spilledNoticeOf, trySpillToolOutput } from '../spill.js';
const ALL_SOURCES = ['annotation', 'note', 'abstract', 'fulltext'];
const DEFAULT_PASSAGES = 4;
const RETRIEVE_PARAMETERS = {
    mode: {
        type: 'string',
        enum: ['evidence', 'fulltext'],
        default: 'evidence',
        description: 'evidence (default): ranked passages. fulltext: whole document.',
    },
    ref: {
        type: 'string',
        description: `Evidence mode: a ${REF_ARG_HINT} item ref from zotero_search or zotero_get.`,
    },
    query: {
        type: 'string',
        description: 'Evidence mode: ranking terms.',
    },
    queryVariants: {
        type: 'array',
        items: { type: 'string' },
        description: `Evidence mode: extra phrasings (up to ${ZOTERO_MAX_QUERY_VARIANTS}); best score wins.`,
    },
    sources: {
        type: 'array',
        items: { type: 'string', enum: ['annotation', 'note', 'abstract', 'fulltext'] },
        default: ALL_SOURCES,
        description: 'Evidence mode: sources to gather; unavailable ones are in sourcesSkipped.',
    },
    passages: {
        type: 'integer',
        default: DEFAULT_PASSAGES,
        description: 'Evidence mode: 1..maxEvidencePassages.',
    },
    attachmentPolicy: {
        type: 'string',
        enum: ['best', 'allIndexed', 'specified'],
        default: 'best',
        description: 'Evidence mode: best, allIndexed, or specified.',
    },
    attachmentRefs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Evidence mode, specified: same-library refs; repeats read once.',
    },
    source: {
        type: 'object',
        additionalProperties: false,
        properties: {
            kind: { type: 'string', enum: ['ref', 'artifactId'], required: true },
            ref: { type: 'string', description: 'Zotero attachment ref for kind="ref".' },
            artifactId: {
                type: 'string',
                description: 'Opaque parsed-artifact id for kind="artifactId".',
            },
        },
        description: 'Fulltext mode: one source. kind="ref" reads an attachment; kind="artifactId" reads a stored parsed artifact, including URL documents.',
    },
    complete: {
        type: 'boolean',
        description: 'Fulltext mode: read the whole bounded document once; returns its text or a spillRef. Excludes start, maxChars, and continuation.',
    },
    start: {
        type: 'integer',
        default: 0,
        description: 'Fulltext mode: window start.',
    },
    maxChars: {
        type: 'integer',
        description: 'Fulltext mode: window chars, bounded by fulltextWindowChars.',
    },
    continuation: {
        type: 'string',
        description: 'Fulltext mode: previous window token; required when start > 0.',
    },
};
const FULLTEXT_FORMAT = { type: 'string', enum: ['markdown', 'text'] };
const ARTIFACT_RECORD = {
    type: 'object',
    additionalProperties: false,
    properties: {
        parser: { type: 'string', enum: ['mineru'], required: true },
        mode: { type: 'string', enum: ['free', 'pro'], required: true },
        artifactId: { type: 'string', required: true },
        fingerprint: { type: 'string', required: true },
        sourceId: { type: 'string', required: true },
        generation: { type: 'string', required: true },
    },
};
const EVIDENCE_RECORD = {
    type: 'object',
    additionalProperties: false,
    properties: {
        source: {
            type: 'string',
            enum: ALL_SOURCES,
            required: true,
        },
        sourceRef: { type: 'string', required: true },
        text: { type: 'string', required: true },
        textFormat: FULLTEXT_FORMAT,
        artifact: ARTIFACT_RECORD,
        start: { type: 'integer' },
        end: { type: 'integer' },
        chunkIndex: { type: 'integer' },
        chunkCount: { type: 'integer' },
        comment: { type: 'string' },
        pageLabel: { type: 'string' },
        attachmentRef: { type: 'string' },
        matchKind: {
            type: 'string',
            enum: ['lexical', 'semantic', 'hybrid'],
            required: true,
        },
        matchedFields: { type: 'array', items: { type: 'string', enum: ['text', 'comment'] } },
    },
};
const COVERAGE_RECORD = {
    type: 'object',
    additionalProperties: false,
    properties: {
        indexedPages: { type: 'integer' },
        totalPages: { type: 'integer' },
        indexedChars: { type: 'integer' },
        totalChars: { type: 'integer' },
        complete: { type: 'boolean', required: true },
    },
};
const RETRIEVE_ATTACHMENT_RECORD = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ref: { type: 'string', required: true },
        contentType: { type: 'string' },
        status: { type: 'string', enum: ['indexed', 'unindexed', 'unread'], required: true },
        textFormat: FULLTEXT_FORMAT,
        artifact: ARTIFACT_RECORD,
        coverage: COVERAGE_RECORD,
        inputTruncated: { type: 'boolean' },
        passages: { type: 'integer' },
    },
};
const FULLTEXT_READ_RECORD = {
    type: 'object',
    additionalProperties: false,
    properties: {
        sourceKind: { type: 'string', enum: ['attachment', 'url'], required: true },
        sourceLabel: { type: 'string', required: true },
        item: {
            type: 'object',
            additionalProperties: false,
            properties: {
                ref: { type: 'string', required: true },
                title: { type: 'string', required: true },
                creatorSummary: { type: 'string', required: true },
                year: { type: 'number' },
                venue: { type: 'string' },
            },
        },
        attachmentContentType: { type: 'string' },
        textFormat: { type: 'string', enum: ['markdown', 'text'], required: true },
        artifact: ARTIFACT_RECORD,
        coverage: COVERAGE_RECORD,
        totalChars: { type: 'integer', required: true },
        inputTruncated: { type: 'boolean', required: true },
        start: { type: 'integer', required: true },
        end: { type: 'integer', required: true },
        text: { type: 'string', required: true },
        isTruncated: { type: 'boolean', required: true },
        nextStart: { type: 'integer' },
        continuation: { type: 'string' },
        attachmentRef: { type: 'string' },
        spillRef: {
            type: 'object',
            additionalProperties: false,
            properties: {
                locator: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                retrievalHint: { type: 'string', required: true },
            },
        },
        spillAvailable: { type: 'boolean', required: true },
    },
};
/** The evidence-mode arm: ranked passages plus the facts that bound them. */
const EVIDENCE_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        mode: { type: 'string', const: 'evidence', required: true },
        ref: { type: 'string', required: true },
        attachmentRef: { type: 'string' },
        attachmentContentType: { type: 'string' },
        textFormat: FULLTEXT_FORMAT,
        artifact: ARTIFACT_RECORD,
        coverage: COVERAGE_RECORD,
        attachments: { type: 'array', items: RETRIEVE_ATTACHMENT_RECORD },
        evidence: { type: 'array', required: true, items: EVIDENCE_RECORD },
        truncated: { type: 'boolean', required: true },
        sourcesSkipped: {
            type: 'array',
            required: true,
            items: { type: 'string', enum: ['annotation', 'note', 'abstract', 'fulltext'] },
        },
        queryTerms: { type: 'array', required: true, items: { type: 'string' } },
        noMatch: { type: 'string', enum: ['no-overlap', 'no-sources'] },
        rankedRoutes: { type: 'array', items: { type: 'string', enum: ['lexical', 'semantic'] } },
    },
};
/** The fulltext-mode arm: one window, and nothing evidence-shaped. */
const FULLTEXT_OUTPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        mode: { type: 'string', const: 'fulltext', required: true },
        fulltext: { ...FULLTEXT_READ_RECORD, required: true },
    },
};
const RETRIEVE_OUTPUT_SCHEMA = {
    oneOf: [EVIDENCE_OUTPUT_SCHEMA, FULLTEXT_OUTPUT_SCHEMA],
};
/** The model-facing messages the retrieve argument rules throw. */
export const RETRIEVE_QUERY_EMPTY_MESSAGE = 'query must be a non-empty string of terms to rank evidence against';
export const RETRIEVE_SOURCES_EMPTY_MESSAGE = 'sources must list at least one evidence source';
export const RETRIEVE_SPECIFIED_EMPTY_MESSAGE = 'attachmentPolicy "specified" requires at least one attachmentRef';
export const RETRIEVE_SPECIFIED_ONLY_MESSAGE = 'attachmentRefs is only valid with attachmentPolicy="specified"';
export const RETRIEVE_MODE_MIXED_MESSAGE = 'Evidence-only parameters (ref, query, queryVariants, sources, passages, attachmentPolicy, attachmentRefs) cannot be used with mode="fulltext"; fulltext-only parameters (source, complete, start, maxChars, continuation) cannot be used with mode="evidence".';
export const RETRIEVE_COMPLETE_MIXED_MESSAGE = 'complete cannot be combined with start, maxChars, or continuation.';
export const RETRIEVE_SOURCE_REQUIRED_MESSAGE = 'mode="fulltext" requires source with exactly one of ref or artifactId.';
export const RETRIEVE_MAX_CHARS_MESSAGE = 'maxChars must be a positive integer no greater than fulltextWindowChars.';
export const RETRIEVE_START_MESSAGE = 'start must be a non-negative integer.';
export const RETRIEVE_EVIDENCE_REQUIRED_MESSAGE = 'mode="evidence" requires ref and query.';
/**
 * The message for an attachmentRef outside the item's own library: the ref's
 * library is named so the model can see which identity the list must match.
 */
export function attachmentRefsLibraryMessage(library) {
    return `attachmentRefs must belong to the same library as ref (${library})`;
}
/**
 * The message for a list of distinct attachmentRefs past the per-call cap.
 * The count names how much work the call asked for and the cap names the
 * split point.
 */
export function attachmentRefsOverCapMessage(count, cap) {
    return `attachmentRefs lists ${count} attachments; at most ${cap} can enter one ranking; split the work across calls`;
}
/**
 * Narrow the model-facing source object to the domain's discriminated form.
 * The wire schema admits two property pairs; exactly one must be present, so
 * the branch that validates also narrows.
 */
function fulltextSourceOf(args) {
    const source = args.source;
    if (source?.kind === 'ref' && typeof source.ref === 'string' && source.artifactId === undefined)
        return { kind: 'ref', ref: source.ref };
    if (source?.kind === 'artifactId' &&
        typeof source.artifactId === 'string' &&
        source.ref === undefined) {
        // A malformed id is the caller's argument mistake, not a missing artifact:
        // shape is admitted here so the provider never sees a doomed lookup. The
        // admission also brands the id, which every read seam below requires.
        const artifactId = artifactIdOf(source.artifactId);
        if (artifactId === undefined)
            invalidArgs('artifactId must be a 64-character lowercase hex string.');
        return { kind: 'artifactId', artifactId };
    }
    invalidArgs(RETRIEVE_SOURCE_REQUIRED_MESSAGE);
}
function buildRequest(args, config) {
    // The schema's `default` is only an annotation: the request's default is
    // resolved here, in one place, so an omitted mode can never reach the domain.
    const mode = args.mode ?? 'evidence';
    if (mode === 'fulltext') {
        if (args.ref !== undefined ||
            args.query !== undefined ||
            args.queryVariants !== undefined ||
            args.sources !== undefined ||
            args.passages !== undefined ||
            args.attachmentPolicy !== undefined ||
            args.attachmentRefs !== undefined)
            invalidArgs(RETRIEVE_MODE_MIXED_MESSAGE);
        if (args.complete === true) {
            if (args.start !== undefined ||
                args.maxChars !== undefined ||
                args.continuation !== undefined)
                invalidArgs(RETRIEVE_COMPLETE_MIXED_MESSAGE);
            return { mode: 'fulltext', source: fulltextSourceOf(args), complete: true };
        }
        const start = args.start ?? 0;
        if (!Number.isInteger(start) || start < 0)
            invalidArgs(RETRIEVE_START_MESSAGE);
        const maxChars = args.maxChars ?? config.fulltextWindowChars;
        if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > config.fulltextWindowChars)
            invalidArgs(RETRIEVE_MAX_CHARS_MESSAGE);
        if (args.continuation !== undefined && args.continuation.trim() === '')
            invalidArgs('continuation must be a non-empty string when provided.');
        return {
            mode: 'fulltext',
            source: fulltextSourceOf(args),
            start,
            maxChars,
            ...(args.continuation === undefined ? {} : { continuation: args.continuation }),
        };
    }
    if (args.source !== undefined ||
        args.complete !== undefined ||
        args.start !== undefined ||
        args.maxChars !== undefined ||
        args.continuation !== undefined)
        invalidArgs(RETRIEVE_MODE_MIXED_MESSAGE);
    if (typeof args.ref !== 'string' || typeof args.query !== 'string')
        invalidArgs(RETRIEVE_EVIDENCE_REQUIRED_MESSAGE);
    requireEvidenceQueryWithinLimit(args.query);
    const query = args.query.trim();
    if (query === '')
        invalidArgs(RETRIEVE_QUERY_EMPTY_MESSAGE);
    const queryVariants = queryVariantsOf(args.queryVariants);
    const passages = args.passages ?? DEFAULT_PASSAGES;
    assertIntInRange('passages', passages, 1, config.maxEvidencePassages);
    const sources = args.sources ?? ALL_SOURCES;
    assertNonEmptyList(sources, RETRIEVE_SOURCES_EMPTY_MESSAGE);
    const ref = parseSupportedRef(args.ref, ['item']);
    const policy = args.attachmentPolicy ?? 'best';
    let attachmentRefs;
    if (args.attachmentPolicy === 'specified') {
        const raw = args.attachmentRefs ?? [];
        if (raw.length === 0) {
            invalidArgs(RETRIEVE_SPECIFIED_EMPTY_MESSAGE);
        }
        attachmentRefs = [];
        // The list is a set: the same attachment named twice would be read twice
        // and would enter the ranking twice, which reads as two sources agreeing
        // with each other. Order stays the caller's; instance-qualified refs stay
        // distinct, because a foreign instance is refused rather than folded in.
        const seen = new Set();
        for (const value of raw) {
            const attachmentRef = parseSupportedRef(value, ['attachment']);
            const identity = formatRef(attachmentRef);
            if (seen.has(identity))
                continue;
            seen.add(identity);
            if (!sameLibrary(attachmentRef.library, ref.library)) {
                invalidArgs(attachmentRefsLibraryMessage(`${ref.library.type}/${ref.library.id}`));
            }
            attachmentRefs.push(attachmentRef);
        }
        if (attachmentRefs.length > config.retrieveAttachmentCap) {
            invalidArgs(attachmentRefsOverCapMessage(attachmentRefs.length, config.retrieveAttachmentCap));
        }
    }
    else if (args.attachmentRefs !== undefined) {
        invalidArgs(RETRIEVE_SPECIFIED_ONLY_MESSAGE);
    }
    return {
        mode: 'evidence',
        ref,
        query,
        ...(queryVariants === undefined ? {} : { queryVariants }),
        sources: [...sources],
        passages,
        ...(args.attachmentPolicy !== undefined ? { attachmentPolicy: policy } : {}),
        ...(attachmentRefs !== undefined ? { attachmentRefs } : {}),
    };
}
/**
 * How the render names each field a passage can match in. The comment label
 * spells out whose words they are: a hit found only there is the annotator's
 * view of the paper, which the model must not attribute to the paper.
 */
const MATCH_FIELD_LABELS = {
    text: 'quoted text',
    comment: 'the reader\u2019s comment',
};
/**
 * The clause appended to a match line whose only hit is a reader comment:
 * those words are the annotator's, not the paper's.
 */
export const PASSAGE_COMMENT_ONLY_CLAUSE = 'those are the annotator\u2019s words, not the paper\u2019s own text';
/** The one-line account of which fields carried the query terms. */
function matchLine(fields) {
    const where = fields.map((field) => MATCH_FIELD_LABELS[field]).join(' and ');
    const onlyComment = fields.includes('comment') && !fields.includes('text')
        ? ` — ${PASSAGE_COMMENT_ONLY_CLAUSE}`
        : '';
    return `Matched in: ${where}${onlyComment}`;
}
/** The short label each match kind renders as inside a passage's bracket. */
const MATCH_KIND_LABELS = {
    lexical: 'query words',
    semantic: 'meaning only',
    hybrid: 'query words and meaning',
};
/**
 * The bracket suffix naming why a passage was returned, empty for the ordinary
 * case (the passage's own words carry the query), which readers assume.
 * Other kinds change how the passage may be used, so they are labeled.
 *
 * An absent kind renders as nothing: sessions recorded before this field
 * replay with `matchKind` missing, and indexing the label table with
 * `undefined` would print "undefined" into the evidence.
 * @param kind - the recorded match kind, possibly absent on a replayed record.
 * @returns the suffix, empty when there is nothing to say.
 */
function matchSuffix(kind) {
    if (kind === undefined || kind === 'lexical')
        return '';
    return `, ${MATCH_KIND_LABELS[kind]}`;
}
/** The one-line note explaining what a semantic-only hit did and did not do. */
export const SEMANTIC_ONLY_NOTE = 'matched on meaning, not on wording: do not quote this passage as containing the query\u2019s terms';
/** The model-facing note for an attachment Zotero has not indexed. */
export const ATTACHMENT_UNINDEXED_NOTE = "no full text in Zotero's index";
/** The model-facing note for an attachment this call's cap left unread. */
export const ATTACHMENT_LIMIT_NOTE = 'not read: this call was already at its attachment limit';
/** The model-facing note for indexed text that yielded no passage within the budget. */
export const ATTACHMENT_BUDGET_EXHAUSTED_NOTE = 'no passage within this call\u2019s character budget';
export const ATTACHMENT_NO_PASSAGES_NOTE = 'indexed text yielded no passages';
/**
 * The honesty line under the full-text sources: how many of them contributed
 * no text, so whatever they contain is not covered.
 */
export function silentAttachmentsMessage(silent, total) {
    return `${silent} of these ${total} attachments contributed no text, so whatever they contain is not covered here.`;
}
/** One full-text source's own facts: what it is, what it gave, what it could not. */
function attachmentSourceLine(source) {
    const type = source.contentType === undefined ? '' : ` (${source.contentType})`;
    if (source.status === 'unindexed') {
        return `${source.ref}${type}: ${ATTACHMENT_UNINDEXED_NOTE}`;
    }
    if (source.status === 'unread') {
        return `${source.ref}${type}: ${ATTACHMENT_LIMIT_NOTE}`;
    }
    const chars = source.coverage?.indexedChars === undefined
        ? ''
        : `, ${source.coverage.indexedChars}/${source.coverage.totalChars ?? '?'} chars indexed`;
    const passages = source.passages ?? 0;
    if (passages === 0)
        return `${source.ref}${type}: ${source.inputTruncated ? ATTACHMENT_BUDGET_EXHAUSTED_NOTE : ATTACHMENT_NO_PASSAGES_NOTE}${chars}`;
    const cut = source.inputTruncated === true ? ', text cut by this call\u2019s character budget' : '';
    return `${source.ref}${type}: ${passages} passages${chars}${cut}`;
}
/**
 * The truncated-result message: what was omitted, what a passage costs, and
 * the call that reads the item's notes and annotations outside the budget.
 */
export const RETRIEVE_TRUNCATED_MESSAGE = 'More evidence was available but omitted by the passage or character budget: a passage charges its text and, for an annotation, its comment.';
/** The remedy half of {@link RETRIEVE_TRUNCATED_MESSAGE}. */
export const RETRIEVE_TRUNCATED_REMEDY = 'zotero_get with include:["notes", "annotations"] reads the item\u2019s notes and annotations outside this budget.';
/**
 * What an empty evidence list means when the semantic route ran: neither the
 * query's words nor its meaning scored any passage. The call establishes only
 * this, not that the item has nothing on the subject.
 */
export const NO_MATCH_MESSAGE = 'No passage matched this query \u2014 neither its terms nor its meaning. That describes this query against the sources this call read; it is not evidence that the item has nothing on the subject.';
/**
 * The same fact when only the lexical route ran; no semantic comparison was
 * made because semantic ranking was off or its model did not answer.
 */
export const NO_MATCH_TERMS_ONLY_MESSAGE = 'No passage matched this query\u2019s terms (semantic ranking was not part of this call). That describes this query against the sources this call read; it is not evidence that the item has nothing on the subject.';
/** The remedy half of {@link NO_MATCH_MESSAGE}. */
export const NO_MATCH_REMEDY = 'Rephrase with the subject\u2019s own terms, pass queryVariants with your own paraphrases, or widen sources.';
/**
 * The message when the item offered no rankable passage at all; the overlap
 * test did not run.
 */
export const NO_SOURCES_MESSAGE = 'The selected sources yielded no rankable passage within this call\u2019s limits, so no overlap test ran.';
/** The remedy half of {@link NO_SOURCES_MESSAGE}. */
export const NO_SOURCES_REMEDY = 'Check that the item has an indexed attachment, or read its files directly with zotero_get.';
/**
 * Why an empty answer is expected: the query carried nothing the lexical route
 * could score.
 */
export const NO_CONTENT_TERMS_MESSAGE = 'The query carried no content words (\u201cthe\u201d, \u201cof\u201d and the like are dropped before scoring), so there was nothing to match; ask with the subject\u2019s own terms.';
export const FULLTEXT_TRUNCATED_REMEDY = 'Continue with start=nextStart and the returned continuation token until isTruncated is false; concatenate the windows in order to obtain the complete document.';
export const FULLTEXT_INPUT_TRUNCATED_REMEDY = 'The document exceeded maxFulltextChars; the windows above cover only its first bounded portion.';
export const FULLTEXT_SPILL_NOTE = 'The whole bounded document is also saved in spill storage; read it through that handle instead of walking every window.';
export const FULLTEXT_COMPLETE_SPILL_NOTE = 'The complete document is in the handle above; read it through that handle.';
/** One line describing Zotero's own indexing coverage of a full-text source. */
function coverageLineOf(coverage) {
    const chars = coverage.indexedChars === undefined
        ? ''
        : `${coverage.indexedChars}/${coverage.totalChars ?? '?'} chars`;
    const pages = coverage.indexedPages === undefined
        ? ''
        : `, ${coverage.indexedPages}/${coverage.totalPages ?? '?'} pages`;
    return `Indexing coverage: ${chars}${pages}${coverage.complete ? ' (complete)' : ''}`;
}
export function renderRetrieve(_args, value) {
    if (value.mode === 'fulltext') {
        const read = value.fulltext;
        // A complete read covers the whole bounded document and carries its text
        // through the spill handle instead of repeating it inline.
        const completeRead = read.spillAvailable && !read.isTruncated && read.start === 0 && read.end === read.totalChars;
        const header = [
            `Full text of ${read.sourceLabel} (${read.textFormat}; ${read.sourceKind} source)`,
            completeRead
                ? `Characters 0–${read.totalChars} of ${read.totalChars}; complete read.`
                : `Characters ${read.start}–${read.end} of ${read.totalChars}; isTruncated: ${read.isTruncated}.`,
            read.totalChars === 0 ? 'This source contains no readable text.' : '',
            read.totalChars > 0 && read.start === read.totalChars
                ? 'End of document; this window contains no further text.'
                : '',
            read.inputTruncated ? FULLTEXT_INPUT_TRUNCATED_REMEDY : '',
            read.isTruncated
                ? `${FULLTEXT_TRUNCATED_REMEDY} (nextStart=${read.nextStart}${read.continuation === undefined ? '' : `; continuation=${read.continuation}`})`
                : '',
            read.coverage === undefined ? '' : coverageLineOf(read.coverage),
            read.spillRef === undefined
                ? ''
                : `${spilledNoticeOf(read.spillRef, completeRead ? read.spillRef.bytes : read.spillRef.bytes - (read.end - read.start)).trimEnd()} ${completeRead ? FULLTEXT_COMPLETE_SPILL_NOTE : FULLTEXT_SPILL_NOTE}`,
        ].filter((line) => line !== '');
        // The blank line separates the header from the document text and must
        // survive the empty-line filter above. A complete read has no inline text.
        return [
            {
                type: 'text',
                text: completeRead ? header.join('\n') : `${header.join('\n')}\n\n${read.text}`,
            },
        ];
    }
    const lines = [
        `Evidence for ${value.ref} (${value.evidence.length} passage${value.evidence.length === 1 ? '' : 's'})`,
    ];
    if (value.evidence.length === 0) {
        if (value.noMatch === 'no-sources') {
            lines.push(NO_SOURCES_MESSAGE, NO_SOURCES_REMEDY);
        }
        else if (value.noMatch === 'no-overlap') {
            // The meaning claim is only made when the semantic route actually ran.
            lines.push(value.rankedRoutes?.includes('semantic') === true
                ? NO_MATCH_MESSAGE
                : NO_MATCH_TERMS_ONLY_MESSAGE);
            // A termless query explains an empty answer only when the lexical route
            // was the whole call. A semantic route can legitimately return nothing
            // without any content words, so the wording claim would misexplain it.
            if (value.queryTerms.length === 0 && !value.rankedRoutes?.includes('semantic')) {
                lines.push(NO_CONTENT_TERMS_MESSAGE);
            }
            else {
                lines.push(NO_MATCH_REMEDY);
            }
        }
        else if (value.truncated) {
            // Matches existed, but the passage/character budgets omitted every one.
            // Say that; never claim "no match" alongside "more matches omitted".
            lines.push(RETRIEVE_TRUNCATED_MESSAGE, RETRIEVE_TRUNCATED_REMEDY);
        }
        // No `noMatch` and no truncation: an empty evidence list with no recorded
        // cause is not a fact we can describe, so no claim is emitted.
    }
    if (value.attachmentRef !== undefined) {
        const type = value.attachmentContentType === undefined ? '' : ` (${value.attachmentContentType})`;
        lines.push(`Full text: ${value.attachmentRef}${type}`);
    }
    if (value.coverage !== undefined) {
        lines.push(coverageLineOf(value.coverage));
    }
    if (value.attachments !== undefined) {
        const total = value.attachments.length;
        const silent = value.attachments.filter((source) => source.status !== 'indexed').length;
        lines.push(`\nFull-text sources read (${total - silent} of ${total}):`, ...value.attachments.map((source) => `  - ${attachmentSourceLine(source)}`));
        if (silent > 0) {
            lines.push(silentAttachmentsMessage(silent, total));
        }
    }
    value.evidence.forEach((entry) => {
        const page = entry.pageLabel === undefined ? entry.source : `${entry.source} (page ${entry.pageLabel})`;
        const chunk = entry.chunkCount === undefined || entry.chunkIndex === undefined
            ? ''
            : `, chunk ${entry.chunkIndex + 1}/${entry.chunkCount}`;
        // The ordinary case (the passage's own words carry the query) needs no
        // label. Other kinds change how the passage may be used, so they are named
        // in the bracket.
        const kind = matchSuffix(entry.matchKind);
        const comment = entry.comment === undefined ? '' : `\nComment: ${entry.comment}`;
        lines.push(`\n[${page}${chunk}${kind}] ${entry.sourceRef}\n${entry.text}${comment}`);
        if (entry.matchKind === 'semantic')
            lines.push(SEMANTIC_ONLY_NOTE);
        if (entry.matchedFields !== undefined) {
            lines.push(matchLine(entry.matchedFields));
        }
    });
    if (value.sourcesSkipped.length > 0) {
        lines.push(`\nSkipped unavailable sources: ${value.sourcesSkipped.join(', ')}`);
    }
    // The budget message is already the whole empty-answer explanation above
    // when every match was omitted; otherwise it accompanies the passages.
    if (value.truncated && !(value.evidence.length === 0 && value.noMatch === undefined))
        lines.push(`\n${RETRIEVE_TRUNCATED_MESSAGE} ${RETRIEVE_TRUNCATED_REMEDY}`);
    return [{ type: 'text', text: lines.join('\n') }];
}
/**
 * The completed retrieve card: the evidence passage count plus whether the
 * budget cut the list, or one fulltext window's span. `meta` is absent on
 * nested code dispatch or malformed replay records, and a failed call keeps
 * the raw error content; both fall back to the generic card.
 */
function presentRetrieveResult(_args, result) {
    const record = metaRecordOf(result);
    if (record === undefined)
        return undefined;
    if (record.mode === 'fulltext') {
        const read = record.fulltextRead;
        if (typeof read !== 'object' || read === null)
            return undefined;
        const { start, end, totalChars } = read;
        // A card that cannot state the span says nothing rather than inventing 0s.
        if (typeof start !== 'number' || typeof end !== 'number' || typeof totalChars !== 'number')
            return undefined;
        return {
            card: 'generic',
            title: `Zotero full text: characters ${start}–${end} of ${totalChars}`,
        };
    }
    if (typeof record.count !== 'number')
        return undefined;
    const truncated = record.truncated === true ? ' (truncated)' : '';
    return { card: 'generic', title: `Zotero evidence: ${record.count} passages${truncated}` };
}
/**
 * Register the `zotero_retrieve` tool. The service's live config is read per
 * request so a settings edit takes effect on the next call without
 * re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export function registerRetrieveTool(ctx, service, wrap = identityToolWrapper) {
    ctx.tools.register(wrap(defineTool({
        name: 'zotero_retrieve',
        description: [
            'mode="evidence": rank passages from one item\u2019s annotations, notes, abstract and full-text chunks against a query; matchKind: lexical = own words carry the query, semantic = meaning only (never quote as carrying the terms), hybrid = both; matchedFields names text or comment, truncated/sourcesSkipped report coverage; noMatch never means the item is silent on the subject.',
            'mode="fulltext": read one document (bounded by maxFulltextChars); source is an attachment ref or stored artifactId. complete=true reads it whole in one call and returns the text or a spillRef; complete excludes start, maxChars, and continuation. Otherwise read windows from start=0, following nextStart and the continuation token until isTruncated is false. Windows may be inline or files; the first may name a whole-text spillRef. Parsed Markdown is preferred; Zotero index text is reported as text. Reads never start a parse or upload.',
            'Evidence mode: queryVariants adds phrasings (best score per passage wins); a note item contributes its own body and child notes every chunk (chunkIndex/chunkCount locate each); attachmentPolicy picks best (default), allIndexed, or specified via attachmentRefs (this item\u2019s children); results are capped by passage count and characters; truncated signals omitted evidence.',
        ].join(' '),
        parameters: RETRIEVE_PARAMETERS,
        output: {
            schema: RETRIEVE_OUTPUT_SCHEMA,
            render: renderRetrieve,
            presentationMeta: (args, value) => boundedPresentationMeta(projectRetrieveMeta(value, args.sources ?? ALL_SOURCES), [
                'items',
            ]),
        },
        presentCall: (args) => ({
            card: 'generic',
            kind: 'search',
            title: args.mode === 'fulltext' ? 'Read Zotero full text' : 'Retrieve Zotero evidence',
            rawInput: args.mode === 'fulltext'
                ? (args.source?.ref ?? args.source?.artifactId ?? '')
                : args.query,
        }),
        presentResult: presentRetrieveResult,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const request = buildRequest(args, service.config);
            if (request.mode === 'fulltext') {
                // A fulltext read persists the whole bounded document once, so the
                // model can read it through one handle instead of every window.
                // The sink is the host spill store's; without one the chain is the
                // only path and the result simply carries no spillRef.
                const spill = async (text) => {
                    // The inline budget decides whether the document is worth a
                    // handle: a bounded document the delivery would keep inline
                    // needs none, and the threshold moves with the same setting.
                    if (!exceedsInlineTokenBudget(text, service.config.maxInlineResultTokens))
                        return undefined;
                    const ref = await trySpillToolOutput(ctx, exec, `${exec.name}-fulltext.md`, text);
                    return ref === undefined
                        ? undefined
                        : {
                            locator: String(ref.locator),
                            bytes: ref.bytes,
                            retrievalHint: ref.retrievalHint,
                        };
                };
                return await service.retrieve(request, exec.signal, spill);
            }
            return await service.retrieve(request, exec.signal);
        },
    })));
}
//# sourceMappingURL=retrieve.js.map