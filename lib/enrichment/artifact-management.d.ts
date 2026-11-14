/**
 * Host-side inventory and cleanup for committed parsed artifacts.
 *
 * A parse publishes its artifact directory (`meta.json` is the commit marker)
 * and its source-index pointer in two separate writes. A crash between them
 * leaves either an orphan directory or a dangling index key, so the inventory
 * unions both views by artifact id instead of trusting either one alone. No
 * per-target `inspect` probe is used: those are session-bound, target-only and
 * may issue a network HEAD.
 * @module dsh-zotero/enrichment/artifact-management
 */
import { type ZoteroDiscardParsedDocumentResultView, type ZoteroListParsedDocumentsRequestView, type ZoteroListParsedDocumentsResultView, type ZoteroParsedDocumentRowView } from '../contract.js';
import type { ParsedArtifactStore } from './artifact-store.js';
import type { ParseJobPersistence, EnrichmentParseJobs } from './parse-jobs.js';
import type { EnrichmentPreferences } from '../enrichment-preferences.js';
/** The wire views are the single row contract; the zod schema is satisfies-checked. */
export type ParsedDocumentRow = ZoteroParsedDocumentRowView;
export type ParsedDocumentList = ZoteroListParsedDocumentsResultView;
export type DiscardResult = ZoteroDiscardParsedDocumentResultView;
export interface ArtifactManagementDeps {
    readonly store: (config: EnrichmentPreferences, create: boolean) => Promise<ParsedArtifactStore>;
    readonly config: () => EnrichmentPreferences;
    readonly persistence: ParseJobPersistence;
    readonly jobs: EnrichmentParseJobs;
}
/** A list window without its session id: authorization belongs to the service seam. */
export type ParsedDocumentQuery = Pick<ZoteroListParsedDocumentsRequestView, 'offset' | 'limit' | 'state' | 'query'>;
/**
 * List every artifact, newest first, narrowed by the requested state and text
 * and then windowed by the page. Filtering runs before the slice, so `total`
 * always counts the rows the filter admits and the pager stays honest.
 */
export declare function listParsedDocuments(deps: ArtifactManagementDeps, request: ParsedDocumentQuery, signal?: AbortSignal): Promise<ParsedDocumentList>;
/**
 * Remove one artifact completely: readers, job receipts, directory, task and
 * every source-index alias. A broken row is still cleanable.
 */
export declare function discardParsedDocument(deps: ArtifactManagementDeps, artifactId: string, signal?: AbortSignal): Promise<DiscardResult>;
//# sourceMappingURL=artifact-management.d.ts.map