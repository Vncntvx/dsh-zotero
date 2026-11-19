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
/** Matches a Windows drive letter at the start of a POSIX-mapped path: `/C:/...` or `/c:/...`. */
export declare const POSIX_WINDOWS_DRIVE_PATTERN: RegExp;
/** Matches a POSIX WSL drive mount: `/mnt/c/...` or `/c/...`. */
export declare const POSIX_WSL_MOUNT_PATTERN: RegExp;
/** Matches WSL interop UNC host names: `wsl.localhost` or `wsl$`. */
export declare const WSL_UNC_HOST_PATTERN: RegExp;
/** Model-facing message when a foreign drive is not mounted in the current environment. */
export declare function unmountedDriveMessage(drive: string, reported: string): string;
/** Model-facing message when an attachment points to an unmapped network share. */
export declare function unsupportedUncShareMessage(uncPath: string): string;
/** Model-facing message when an attachment points to a WSL UNC share that cannot be reached. */
export declare function unsupportedWslUncMessage(reported: string): string;
/** Convert a drive letter and POSIX subpath to a native Win32 path. */
export declare function toWin32Path(drive: string, subpath: string): string;
/**
 * Parse Linux mount points from `/proc/mounts` or mountinfo text.
 * Discovers where Windows drives are mounted under WSL drvfs/9p.
 * Correctly accounts for Linux kernel octal escaping (`\134` for `\`).
 * Returns a map from lowercase drive letter to list of mount paths (e.g. `'c' -> ['/mnt/c']`).
 */
export declare function parseWslMounts(mountsContent: string): Map<string, string[]>;
/** Clear the process-level WSL mounts cache (primarily for tests). */
export declare function clearWslMountsCache(): void;
/**
 * Read active WSL mount points from `/proc/mounts` if available.
 * Memoizes results at the module level when running against the default filesystem.
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
export type ParsedAttachmentLocation = {
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
//# sourceMappingURL=path-resolution.d.ts.map