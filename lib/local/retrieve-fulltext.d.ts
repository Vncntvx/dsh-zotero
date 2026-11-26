import { type EvidenceChunk } from '../evidence.js';
import type { SupportedLocalLibrary, ZoteroCoverage, ZoteroFulltextPayload, ZoteroObjectRef, ZoteroRetrieveAttachment } from '../types.js';
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { DiagnosticSink } from '../diagnostics.js';
import { type FulltextEnhancer, type FulltextEnhancerInput, type FulltextLookupResult } from './fulltext-enhancer.js';
import type { EvidenceRanker } from './evidence-ranker.js';
export { isPdfCandidateContentType } from './fulltext-enhancer.js';
import type { FulltextSpillSink } from '../fulltext-spill.js';
/**
 * The full-text deps. `enhancer` is the optional document-enrichment slot the
 * core holds for `dsh-zotero/enrichment`; when it is absent every read below runs
 * exactly the original loopback path. Enhancer errors propagate. `ranker` is
 * the ranking strategy the retrieve domain ranks through: the core's lexical
 * ranker, or the hybrid one the enrichment component installs, read live per
 * request.
 */
export interface FulltextDeps {
    readonly client: ZoteroHttpClient;
    readonly limits: LocalApiLimits;
    readonly enhancer?: FulltextEnhancer;
    readonly sink?: DiagnosticSink;
    readonly ranker: EvidenceRanker;
    /** Optional whole-document spill for fulltext-mode reads. */
    readonly spill?: FulltextSpillSink;
}
/**
 * Reuse a valid parsed artifact for one PDF. A missing artifact returns
 * `undefined` so the caller reads Zotero's index; storage faults propagate.
 */
export declare function lookupParsedFulltext(deps: FulltextDeps, input: FulltextEnhancerInput, signal: AbortSignal | undefined): Promise<Extract<FulltextLookupResult, {
    kind: 'hit';
}> | undefined>;
/**
 * The complete text of one document and the provenance of its source.
 * Parsed artifacts provide MinerU Markdown; indexed attachments provide
 * Zotero's text and coverage facts.
 */
interface FulltextDocument {
    readonly text: string;
    readonly textFormat: 'markdown' | 'text';
    readonly sourceKind: 'attachment' | 'url';
    /** Display label using an attachment ref or URL origin. */
    readonly sourceLabel: string;
    readonly item?: import('../types.js').ZoteroFulltextItem;
    readonly attachmentContentType?: string;
    readonly artifact?: Extract<FulltextLookupResult, {
        kind: 'hit';
    }>['provenance'];
    readonly coverage?: import('../types.js').ZoteroCoverage;
    readonly attachmentRef?: string;
}
/** Read one document's complete text in source order. */
export declare function readFulltextDocument(deps: FulltextDeps, source: import('../types.js').ZoteroFulltextSource, signal: AbortSignal | undefined): Promise<FulltextDocument>;
/**
 * Apply the call's input bound, then take a UTF-16 window without splitting a surrogate pair.
 * Consecutive windows remain losslessly joinable through
 * `nextStart`. The bounded whole text rides out with the window so the caller
 * can offer a one-handle copy without re-truncating.
 */
export declare function fulltextWindowOf(document: FulltextDocument, start: number, maxChars: number, maxFulltextChars: number): {
    readonly read: Omit<import('../types.js').ZoteroFulltextRead, 'spillAvailable'>;
    readonly boundedText: string;
};
/** The message when a continuation window arrives without its token. */
export declare const FULLTEXT_CONTINUATION_REQUIRED_MESSAGE = "start > 0 requires the continuation token returned with the previous window; restart at start=0.";
/** The message when the document changed between two windows. */
export declare const FULLTEXT_CONTINUATION_CHANGED_MESSAGE = "The document changed between read windows, so the windows would come from different versions. Discard the earlier text and restart at start=0.";
/**
 * Generates a stateless continuation token for a bounded document, binding
 * source identity, artifact generation, bounded length, and text SHA-256
 * across consecutive window reads.
 */
export declare function fulltextContinuationOf(document: FulltextDocument, boundedText: string): string;
/**
 * Validates a continuation token against the document's current source,
 * artifact generation, bounded length, and content digest.
 */
export declare function assertFulltextContinuation(document: FulltextDocument, boundedText: string, token: string): void;
/**
 * One full-text source of a retrieval and what reading it produced. The arms
 * carry exactly what their status can prove: an indexed source has Zotero's
 * coverage facts, its accepted chunks and whether this call's budget cut it;
 * an unindexed or unread one has nothing to report beyond the fact that it
 * contributed no text. The fetched payload is read in the worker and not
 * kept, because the chunks are what survives, so a large body is released
 * instead of being held until the ranking pass.
 */
export type FulltextSource = {
    readonly key: string;
    readonly contentType?: string;
} & ({
    readonly status: 'indexed';
    readonly textFormat: 'markdown' | 'text';
    readonly artifact?: Extract<FulltextLookupResult, {
        kind: 'hit';
    }>['provenance'];
    /** Absent for MinerU-derived text, which has no Zotero index coverage. */
    readonly coverage?: ZoteroCoverage;
    readonly inputTruncated: boolean;
    readonly chunks: readonly EvidenceChunk[];
} | {
    readonly status: 'unindexed';
} | {
    readonly status: 'unread';
});
/** Cut enhanced or index text to a per-source budget and chunk it. */
export declare function chunkFulltext(text: string, perSourceChars: number, limits: LocalApiLimits): {
    readonly inputTruncated: boolean;
    readonly chunks: readonly EvidenceChunk[];
};
/**
 * Full-text indexing coverage as reported by Zotero. `complete` is derived
 * per axis: the chars axis (text files) and the pages axis (PDFs) each count
 * as complete when the server reports both sides and they agree; the overall
 * answer is complete when at least one axis is reportable and every
 * reportable axis agrees. Anything else is an incomplete answer, never a
 * guess, so a full PDF index without char counts still reads complete.
 */
export declare function normalizeCoverage(payload: ZoteroFulltextPayload): ZoteroCoverage;
/**
 * The per-source fact a result reports for one considered attachment: an
 * indexed source carries what it gave, the others carry only their status,
 * which is itself the finding ("Zotero's index has no text for this file" /
 * "this call did not read it").
 */
export declare function attachmentFactOf(source: FulltextSource): Omit<ZoteroRetrieveAttachment, 'ref' | 'contentType'>;
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
export declare function readFulltextSources(deps: FulltextDeps, ref: ZoteroObjectRef, serverId: string | undefined, candidates: readonly {
    key: string;
    contentType?: string;
}[], signal: AbortSignal | undefined): Promise<FulltextSource[]>;
export declare function fetchFulltext(deps: {
    client: ZoteroHttpClient;
}, attachmentKey: string, library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined): Promise<ZoteroFulltextPayload>;
//# sourceMappingURL=retrieve-fulltext.d.ts.map