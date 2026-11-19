/**
 * The SSRF-safe streaming download client for pinned model files.
 *
 * The model sources are fixed hosts (hf-mirror.com, huggingface.co), but every
 * redirect target is a dynamic untrusted address, so each hop re-runs the same
 * public-address double gate the MinerU client uses: `isPublicUrl` (lexical)
 * plus `resolvePublicAddresses` with the answers pinned into the connection,
 * HTTPS only, no downgrade, no userinfo, five hops at most.
 *
 * A pinned dispatcher is owned by one response-consumption scope: the response
 * body is drained or cancelled before `close()`. Redirect, error, length,
 * checksum and abort paths end the body first to avoid deadlocking a slow large
 * response against a closed connection. Streamed bytes land in an exclusively
 * created file inside a caller-owned directory; predictable temp symlinks are
 * not followed.
 * @module dsh-zotero/enrichment/model-download-client
 */
import type { SemanticDownloadSource, SemanticModelSpec } from '../enrichment-model-catalog.js';
import { type AddressResolver, type PinnedDispatcher, type ResolvedAddress } from '../transport/network.js';
/** The fixed model mirrors. URLs pin the revision, not a moving branch. */
export declare const MODEL_SOURCES: Record<SemanticDownloadSource, {
    readonly label: string;
    readonly url: (model: SemanticModelSpec, path: string) => string;
}>;
export declare const DEFAULT_SOURCE_ORDER: readonly SemanticDownloadSource[];
/** One file may take this long in total, mirrors included. */
export declare const DOWNLOAD_FILE_TIMEOUT_MS: number;
/** No bytes for this long aborts the attempt; mirrors stall silently. */
export declare const DOWNLOAD_STALL_TIMEOUT_MS: number;
/** The slice of undici's Response the client relies on; tests stub it. */
export interface FetchLike {
    (url: string, init?: {
        readonly method?: string;
        readonly redirect?: 'manual';
        readonly signal?: AbortSignal;
        readonly dispatcher?: PinnedDispatcher['dispatcher'];
    }): Promise<{
        readonly ok: boolean;
        readonly status: number;
        readonly headers: {
            get(name: string): string | null;
        };
        readonly body: ReadableStream<Uint8Array> | null;
    }>;
}
/** Filesystem seams, injectable so tests never write to real disk. */
export interface DownloadFsDeps {
    readonly mkdir: (path: string) => Promise<void>;
    readonly rename: (from: string, to: string) => Promise<void>;
    readonly rm: (path: string) => Promise<void>;
    /** Exclusive create: an existing path (including a symlink) is refused. */
    readonly openExclusive: (path: string) => Promise<NodeJS.WritableStream>;
}
export declare const hostDownloadFsDeps: DownloadFsDeps;
export interface DownloadClientDeps {
    readonly fetch?: FetchLike;
    readonly resolver?: AddressResolver;
    readonly dispatcher?: (addresses: readonly ResolvedAddress[]) => PinnedDispatcher;
    readonly fs?: DownloadFsDeps;
}
export interface DownloadPinnedFileOptions {
    readonly model: SemanticModelSpec;
    readonly file: {
        readonly path: string;
        readonly bytes: number;
        readonly sha256: string;
    };
    readonly dir: string;
    /** Preferred source first; the rest are fallbacks in catalog order. */
    readonly sources: readonly SemanticDownloadSource[];
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly stallMs?: number;
    readonly deps?: DownloadClientDeps;
}
export interface DownloadPinnedFileResult {
    readonly source: SemanticDownloadSource;
    readonly bytes: number;
    readonly sha256: string;
}
/**
 * Download one pinned file from the first mirror that serves the exact bytes.
 * @returns where the bytes came from and their verified digest.
 */
export declare function downloadPinnedFile(options: DownloadPinnedFileOptions): Promise<DownloadPinnedFileResult>;
//# sourceMappingURL=model-download-client.d.ts.map