/**
 * @module dsh-zotero/local/retrieve-fulltext
 */
import { type EvidenceChunk } from '../evidence.js';
import type { ZoteroHttpClient } from '../http-client.js';
import type { LocalApiLimits } from './limits.js';
import type { DiagnosticSink } from '../diagnostics.js';
import { isPdfCandidateContentType, type FulltextEnhancer, type FulltextEnhancerInput, type FulltextLookupResult } from './fulltext-enhancer.js';
import type { EvidenceRanker } from './evidence-ranker.js';
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
}
/**
 * Reuse a valid parsed artifact for one PDF. A missing artifact returns
 * `undefined` so the caller reads Zotero's index; storage faults propagate.
 */
export declare function lookupParsedFulltext(deps: FulltextDeps, input: FulltextEnhancerInput, signal: AbortSignal | undefined): Promise<Extract<FulltextLookupResult, {
    kind: 'hit';
}> | undefined>;
/** Only PDF candidates are offered to the parser; known non-PDF types skip it. */
export declare const isPdfCandidate: typeof isPdfCandidateContentType;
import type { SupportedLocalLibrary, ZoteroCoverage, ZoteroFulltextPayload, ZoteroObjectRef, ZoteroRetrieveAttachment } from '../types.js';
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
    readonly bounded: string;
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
 * accepts at most `maxFulltextChars` characters, split evenly across the
 * sources it reads, so no single file can starve the others and the result
 * does not depend on which read finished first, and an unindexed member
 * degrades alone rather than failing the call. Each file is chunked as it
 * arrives, so its full text is released instead of being held for a ranking
 * pass at the end.
 */
export declare function readFulltextSources(deps: FulltextDeps, ref: ZoteroObjectRef, serverId: string | undefined, candidates: readonly {
    key: string;
    contentType?: string;
}[], signal: AbortSignal | undefined): Promise<FulltextSource[]>;
export declare function fetchFulltext(deps: {
    client: ZoteroHttpClient;
}, attachmentKey: string, library: SupportedLocalLibrary, serverId: string | undefined, signal: AbortSignal | undefined): Promise<ZoteroFulltextPayload>;
//# sourceMappingURL=retrieve-fulltext.d.ts.map