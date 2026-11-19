import type { EnrichmentMode } from '../enrichment-preferences.js';
import type { ParsedArtifact } from './types.js';
import { MineruClient } from './transport.js';
import type { ParsedArtifactStore } from './artifact-store.js';
import { ArchiveProcessor } from './archive-worker.js';
import { type ArtifactReaderPreferences } from '../artifact-reader-preferences.js';
export interface ParseOnceDeps {
    readonly client: MineruClient;
    readonly store: ParsedArtifactStore;
    /** The per-service single-flight table. */
    readonly flight: ParseFlight;
    /** Poll/size bounds; tests supply small values, production uses the defaults. */
    readonly timing?: {
        readonly pollIntervalMs?: number;
        readonly maxPolls?: number;
        readonly totalTimeoutMs?: number;
    };
}
export type ParsePhase = 'acquiring' | 'uploading' | 'waiting' | 'downloading' | 'validating' | 'writing';
export interface ParseOnceInput {
    /** Stable identity (attachment ref or URL); also the cache-key input. */
    readonly identity: string;
    /** Job-owned parse attempt: retries keep it; explicit re-parses replace it. */
    readonly generation: string;
    readonly mode: EnrichmentMode;
    /** Omitted means the published MinerU default; pro mode does not send this parameter. */
    readonly ocrLanguage?: string;
    readonly bytes: Uint8Array;
    /**
     * The SHA-256 of `bytes`, when the caller already hashed them — the service
     * fingerprints once for its cache write and hands the digest in, so the
     * same bytes are not hashed again here. Absent (tests, direct callers),
     * one is computed.
     */
    readonly fingerprint?: string;
    /** Resolved precise-API token; present only in pro mode. */
    readonly token?: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (phase: ParsePhase) => void;
}
/** The SHA-256 of one document, the fingerprint the cache and meta agree on. */
export declare function contentFingerprintOf(bytes: Uint8Array): string;
export interface ParseOnceResult {
    readonly artifact: ParsedArtifact;
    readonly cacheKey: string;
    /** True only when this generation reused an already committed artifact. */
    readonly cached: boolean;
}
type ParseCacheIdentity = Pick<ParseOnceInput, 'identity' | 'generation' | 'mode' | 'ocrLanguage'> & ({
    readonly fingerprint: string;
    readonly bytes?: Uint8Array;
} | {
    readonly fingerprint?: string;
    readonly bytes: Uint8Array;
});
/** Cache key folds identity, mode, generation, and the exact content fingerprint. */
export declare function cacheKeyOf(input: ParseCacheIdentity): string;
/**
 * One `EnrichmentService`'s in-flight parse table.
 *
 * The map is per service (not module-global) so two service instances cannot
 * hand each other artifacts for a store they do not own. The shared task uses
 * the entry's own controller; callers race their own signals against it.
 */
export declare class ParseFlight {
    readonly archives: ArchiveProcessor;
    constructor(policy?: () => ArtifactReaderPreferences);
    private readonly entries;
    run(key: string, callerSignal: AbortSignal | undefined, task: (flightSignal: AbortSignal) => Promise<ParseOnceResult>): Promise<ParseOnceResult>;
    private start;
}
/**
 * Parse one generation, reusing only that generation's committed artifact.
 * @throws {ZoteroError} on any submit/task/runtime failure.
 */
export declare function parseOnce(input: ParseOnceInput, deps: ParseOnceDeps): Promise<ParseOnceResult>;
export {};
//# sourceMappingURL=parse-once.d.ts.map