/**
 * Cross-platform path resolution for Zotero attachment file locations.
 *
 * Zotero's Local API runs on the host that owns the library, so a Windows-side
 * Zotero reports file URLs using Windows semantics (`file:///C:/…` or UNC
 * `file://server/share/…` or `file://wsl.localhost/…`). When the plugin runs
 * under POSIX (especially WSL or Linux containers), Node's native `fileURLToPath`
 * turns a drive-letter URL into `/C:/…` — a path that exists on no normal Linux
 * filesystem, leading to false ENOENT errors.
 *
 * This module provides multi-candidate path resolution, WSL mount detection
 * (including custom `/etc/wsl.conf` automount roots), UNC host handling,
 * and semantic error discrimination (distinguishing genuinely missing files
 * from unmounted foreign drives).
 * @module dsh-zotero/local/path-resolution
 */
/** Model-facing message when a foreign drive is not mounted in the current environment. */
export declare function unmountedDriveMessage(drive: string, reported: string): string;
/** Model-facing message when an attachment points to an unmapped network share. */
export declare function unsupportedUncShareMessage(uncPath: string): string;
/** Model-facing message when an attachment points to a WSL UNC share that cannot be reached. */
export declare function unsupportedWslUncMessage(reported: string): string;
/**
 * Parse Linux mount points from `/proc/mounts` or mountinfo text.
 * Discovers where Windows drives are mounted under WSL drvfs/9p.
 * Correctly accounts for Linux kernel octal escaping (`\134` for `\`).
 * Returns a map from lowercase drive letter to list of mount paths (e.g. `'c' -> ['/mnt/c']`).
 */
export declare function parseWslMounts(mountsContent: string): Map<string, string[]>;
/**
 * One mount-table reader per owning instance. The mount table rarely changes
 * during a provider's lifetime, so the memo keeps one `/proc/mounts` read per
 * instance instead of one per attachment resolution; a provider rebuild (a
 * transport reconfiguration) simply reads again.
 */
export declare function createWslMountsMemo(deps?: {
    readFileSync?: (path: string, encoding: 'utf-8') => string;
}): () => Map<string, string[]>;
/**
 * Read active WSL mount points from `/proc/mounts` if available. Pure per
 * call: callers that repeat the read own the memo (`createWslMountsMemo`),
 * and tests inject `readFileSync` directly.
 */
export declare function discoverWslMounts(deps?: {
    readFileSync?: (path: string, encoding: 'utf-8') => string;
}): Map<string, string[]>;
/**
 * Discover possible mount root candidates for a given drive letter on POSIX.
 * Returns discovered and explicit roots, plus conventional roots only under WSL.
 */
export declare function candidateMountRootsForDrive(drive: string, options?: {
    mountPointsMap?: Map<string, string[]>;
    mountRoot?: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
}): string[];
/** Structured representation of a parsed attachment file URL. */
type ParsedAttachmentLocation = {
    readonly kind: 'windows-drive';
    readonly drive: string;
    readonly subpath: string;
    readonly reported: string;
} | {
    readonly kind: 'wsl-unc';
    readonly distro: string;
    readonly subpath: string;
    readonly reported: string;
} | {
    readonly kind: 'remote-unc';
    readonly uncPath: string;
    readonly reported: string;
} | {
    readonly kind: 'wsl-mount-on-windows';
    readonly drive: string;
    readonly subpath: string;
    readonly reported: string;
} | {
    readonly kind: 'local-path';
    readonly path: string;
    readonly reported: string;
};
/**
 * Parse an attachment file URL safely across OS platforms.
 * Handles Windows drive letters, WSL UNC paths, network UNC hosts, and standard local paths.
 */
export declare function parseAttachmentFileUrl(target: URL, platform?: NodeJS.Platform): ParsedAttachmentLocation;
/**
 * Generate candidate local filesystem paths for a parsed attachment location.
 * The candidates are returned in deterministic priority order:
 * most likely existing paths on the current platform are ordered first.
 */
export declare function candidateLocalPaths(parsed: ParsedAttachmentLocation, options?: {
    platform?: NodeJS.Platform;
    mountPointsMap?: Map<string, string[]>;
    mountRoot?: string;
    env?: NodeJS.ProcessEnv;
}): string[];
/** Dependencies for resolving an attachment file on disk. */
export interface PathResolutionDeps {
    readonly access?: (path: string) => Promise<void>;
    readonly readFileSync?: (path: string, encoding: 'utf-8') => string;
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly mountRoot?: string;
    readonly signal?: AbortSignal;
    readonly missingFileMessage?: (path: string) => string;
    /**
     * The owning instance's memoized mount-table reader. Absent (tests, ad-hoc
     * callers) resolves live.
     */
    readonly wslMounts?: () => Map<string, string[]>;
}
/**
 * Resolve an attachment `file:` URL to an existing, verified path on the local filesystem.
 *
 * If the file is found at any candidate path, returns that path.
 * If all candidates fail:
 * - When a Windows drive was reported and no candidate mount root exists, throws `ZOTERO_FILE_UNREADABLE`
 *   with an explicit unmounted drive diagnosis.
 * - When the mount root exists but the file is missing inside it, throws `ZOTERO_FILE_MISSING`
 *   with the missing file message.
 * - For unmapped remote UNC paths or unreachable WSL UNC paths on non-WSL hosts, throws `ZOTERO_FILE_UNREADABLE`.
 */
export declare function resolveExistingAttachmentPath(target: URL, deps?: PathResolutionDeps): Promise<{
    path: string;
    reported: string;
}>;
export {};
//# sourceMappingURL=path-resolution.d.ts.map