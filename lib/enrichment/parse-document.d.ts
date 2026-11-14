/**
 * Private active parsing domain. Only an explicitly started enrichment job
 * calls this entry; the core reader can only look up committed artifacts.
 * Configuration and generation belong to the job's immutable snapshot.
 * @module dsh-zotero/enrichment/parse-document
 */
import type { EnrichmentPreferences } from '../enrichment-preferences.js';
import { type FulltextArtifactProvenance } from '../local/fulltext-enhancer.js';
import type { ParsedArtifactStore } from './artifact-store.js';
import { parseOnce, type ParseFlight, type ParsePhase } from './parse-once.js';
import { type SourceBytesDeps } from './source-bytes.js';
import type { MineruClient } from './transport.js';
import { type FulltextSourceStamp, type ParsedArtifact, type ParseSourceInput } from './types.js';
export interface ParseDocumentDeps {
    /** Plain job snapshot, never a callback reading live service configuration. */
    readonly config: EnrichmentPreferences;
    /** Retry keeps this generation; a forced parse is a new job generation. */
    readonly generation: string;
    readonly client: MineruClient;
    /** Resolve and validate the snapshot's output directory before source I/O. */
    readonly store: (config: EnrichmentPreferences) => Promise<ParsedArtifactStore>;
    readonly parse?: typeof parseOnce;
    readonly flight: ParseFlight;
    readonly resolveAttachment: SourceBytesDeps['resolveAttachment'];
    /** Production binds resolveMineruToken to the component context. */
    readonly resolveToken: (reference: string) => Promise<string>;
    readonly onProgress?: (phase: ParsePhase) => void;
    /** External filesystem ports; omitted in production for real stat/readFile. */
    readonly sourceFiles?: Pick<SourceBytesDeps, 'stat' | 'readFile'>;
}
/** A fulfilled parse is committed: its source pointer is readable, or was already cached. */
export interface ParseDocumentResult {
    readonly artifact: ParsedArtifact;
    readonly cacheKey: string;
    /** The actual source-index or parseOnce branch, including shared-flight hits. */
    readonly cached: boolean;
    readonly stamp: FulltextSourceStamp;
    readonly provenance: FulltextArtifactProvenance;
}
/**
 * Acquire and parse one authorized PDF, or resume its generation's receipt.
 * Every failure is a stable ZoteroError except the caller's own abort reason.
 */
export declare function parseDocument(input: ParseSourceInput, deps: ParseDocumentDeps, signal?: AbortSignal): Promise<ParseDocumentResult>;
//# sourceMappingURL=parse-document.d.ts.map