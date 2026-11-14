/**
 * The per-service manager for local embedding-model bundles: status, download,
 * cancel, verify, force re-download, and delete.
 *
 * One canonical `<model>|<directory>` owns a synchronous reservation covering
 * directory validation, the cross-process lock, streaming, publication and
 * cleanup. Concurrent `start` calls join that one writer; `cancel` aborts and
 * waits for the actual transfer release; `dispose` closes admission, aborts
 * every owned task and waits for them to settle. A committed publication wins
 * over a cancellation that lands during the final atomic marker rename.
 *
 * `status` and `verify` are read-only: they never create the model root, the
 * model directory or a draft directory. Readiness is one shared rule — the
 * commit marker must equal the catalog record and every pinned file must hash
 * to its pin on the same file-identity snapshot. A same-size corrupt file is
 * never "already-ready".
 * @module dsh-zotero/enrichment/model-downloader
 */
import { lstat } from 'node:fs/promises';
import { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED } from '../errors.js';
import { type SafeDirectoryDeps } from './safe-directory.js';
import { type DownloadClientDeps } from './model-download-client.js';
import { installModelBundle } from './model-installation.js';
export interface SemanticModelStatus {
    readonly model: string;
    readonly ready: boolean;
    readonly downloading: boolean;
    readonly path: string;
    readonly downloadedBytes: number;
    readonly totalBytes: number;
    readonly percent: number;
    readonly currentFile?: string;
    readonly error?: string;
    /** The install committed but its staging cleanup failed; the model is usable. */
    readonly warning?: string;
}
export interface SemanticModelDownloadResult {
    readonly success: boolean;
    readonly model: string;
    readonly status: 'started' | 'already-ready' | 'downloading';
    readonly path: string;
}
export interface SemanticModelDeleteResult {
    readonly success: boolean;
    readonly model: string;
    readonly path: string;
    readonly removed: boolean;
    readonly removedFiles: number;
    readonly removedBytes: number;
}
export interface ModelDownloadManagerDeps {
    /** Client seams for the streaming downloader; tests inject scripted ones. */
    readonly client?: DownloadClientDeps;
    /** Filesystem seams for the safe-directory resolver; tests inject theirs. */
    readonly fs?: SafeDirectoryDeps;
    /** The model-directory lstat seam; defaults to the host filesystem. */
    readonly lstat?: (path: string) => ReturnType<typeof lstat>;
    /** The bundle installation seam; defaults to the real installer. */
    readonly install?: typeof installModelBundle;
}
export declare class ModelDownloadManager {
    private readonly entries;
    /** Targets a deletion owns from its first line, before any await. */
    private readonly removing;
    private readonly clientDeps;
    private readonly fsDeps;
    private readonly lstatOf;
    private readonly installOf;
    private closed;
    constructor(deps?: ModelDownloadManagerDeps);
    /**
     * Report one model's state. A live task takes precedence, then the shared
     * read-only disk inspection. A stale error entry is dropped once the disk
     * looks ready, so an out-of-band install is reflected in the status.
     */
    status(model: string, modelDir?: string): Promise<SemanticModelStatus>;
    /**
     * Delete the selected model's marker and pinned files. Unknown files stay,
     * and an active download for the same target is refused.
     *
     * A deletion owns its target from the first line, before any await: the
     * download and the deletion otherwise raced through the install lock, and the
     * lock only orders the file writes — whoever acquired it last decided the
     * final state, so a finished download could reappear over a deletion (or the
     * reverse) with both calls reporting success.
     */
    remove(model: string, modelDir?: string, signal?: AbortSignal): Promise<SemanticModelDeleteResult>;
    /**
     * Start (or join) a download. The reservation is installed synchronously,
     * before the first asynchronous directory probe, so two concurrent starts
     * can never launch two writers and `dispose` covers a validation that is
     * still suspended. `force` re-downloads into a private staging directory and
     * replaces only catalog files, preserving user-owned extras.
     */
    start(options: {
        readonly model?: string;
        readonly source?: string;
        readonly modelDir?: string;
        readonly force?: boolean;
    }): Promise<SemanticModelDownloadResult>;
    /** Abort the one active download, waiting for its real cleanup to settle. */
    cancel(model: string, modelDir?: string): Promise<boolean>;
    /**
     * Hash every pinned file of one installed bundle. The expensive, definitive
     * check behind the "verify model" action.
     */
    verify(model: string, modelDir?: string): Promise<SemanticModelStatus>;
    /** Close admission, abort every owned task and wait for them to settle. */
    dispose(): Promise<void>;
    private inspect;
    /** Resolve the canonical target, decide admission, and own the writer task. */
    private admit;
    private fail;
    private runInstall;
}
export { ZOTERO_ENRICHMENT_MODEL_DOWNLOAD_FAILED as MODEL_DOWNLOAD_FAILED_CODE };
//# sourceMappingURL=model-downloader.d.ts.map