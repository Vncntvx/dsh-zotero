import { HarnessError } from '@deepseek-ai/dsh-error';
import type { SemanticModelManifest } from '../enrichment-model-catalog.js';
/**
 * The machine code every installation failure carries. `runInstall` hands the
 * failure to its caller inside a `ZoteroError`, so the code stays out of the
 * Zotero vocabulary; `HarnessError` is what lets a direct caller route on
 * `name`/`code` instead of parsing the message.
 */
export declare const MODEL_INSTALLATION_FAILED = "MODEL_INSTALLATION_FAILED";
export declare class ModelInstallationError extends HarnessError {
    constructor(message: string, options?: {
        readonly cause?: unknown;
    });
}
export interface ModelInstallationFile {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
}
export interface BundleFileIdentity {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
}
export interface BundlePathSnapshot {
    readonly relativePath: string;
    readonly path: string;
    readonly identity?: BundleFileIdentity;
}
export interface BundleSnapshot {
    readonly dir: string;
    readonly catalogFingerprint: string;
    readonly identityFingerprint: string;
    readonly directories: readonly BundlePathSnapshot[];
    readonly manifest: BundlePathSnapshot;
    readonly files: readonly BundlePathSnapshot[];
}
export interface BundleInspection {
    readonly kind: 'ready' | 'missing' | 'corrupt';
    readonly snapshot: BundleSnapshot;
    readonly totalBytes: number;
    readonly presentBytes: number;
    readonly verifiedBytes: number;
    readonly reason?: string;
    readonly manifest: {
        readonly kind: 'valid' | 'missing' | 'corrupt';
        readonly reason?: string;
    };
    readonly files: readonly {
        readonly relativePath: string;
        readonly kind: 'valid' | 'missing' | 'corrupt';
        readonly bytes: number;
        readonly sha256?: string;
        readonly reason?: string;
    }[];
}
export interface ModelBundleTarget {
    readonly dir: string;
    readonly expected: SemanticModelManifest;
}
export interface ModelBundleInspectorPort {
    snapshot(target: ModelBundleTarget, options?: {
        readonly signal?: AbortSignal;
    }): Promise<BundleSnapshot>;
    inspect(target: ModelBundleTarget, options?: {
        readonly forceHash?: boolean;
        readonly signal?: AbortSignal;
    }): Promise<BundleInspection>;
}
export interface ModelInstallationOptions {
    /** Canonical `<root>/<physicalKey>` directory. */
    readonly dir: string;
    readonly expected: SemanticModelManifest;
    readonly inspector: ModelBundleInspectorPort;
    readonly force?: boolean;
    readonly signal?: AbortSignal;
    /** Write exactly this pinned file under the owned staging directory. */
    readonly transfer: (file: ModelInstallationFile, stagingDir: string, signal: AbortSignal) => Promise<void>;
    /**
     * Remove the private staging directory after publication; injectable so a
     * spec can exercise the cleanup-failure arm without a hostile filesystem.
     */
    readonly cleanup?: (stagingDir: string) => Promise<void>;
}
export interface ModelInstallationResult {
    readonly status: 'installed' | 'already-ready';
    readonly dir: string;
    /** Cleanup failure after a committed publication; never turns success into failure. */
    readonly cleanupError?: unknown;
}
export declare function assertModelLockPath(filename: string, signal: AbortSignal | undefined): Promise<void>;
export declare function safeModelRelativePath(value: string): string;
/**
 * Install or join one pinned bundle under a 60-second cross-process writer lock.
 * A transport failure never publishes a marker; a completed marker commit is a
 * real success even if the caller cancels during the final atomic rename.
 */
export declare function installModelBundle(options: ModelInstallationOptions): Promise<ModelInstallationResult>;
//# sourceMappingURL=model-installation.d.ts.map