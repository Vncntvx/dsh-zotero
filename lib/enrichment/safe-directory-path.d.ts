/** Filesystem seams, injectable so unit tests never touch the real disk. */
export interface SafePathDeps {
    readonly realpath: (path: string) => Promise<string>;
    /** Resolve existing ancestors while preserving the complete missing suffix. */
    readonly canonicalize?: (path: string) => Promise<string>;
    readonly stat: (path: string) => Promise<{
        isDirectory(): boolean;
    }>;
    readonly access: (path: string, mode: number) => Promise<void>;
    readonly mkdir: (path: string) => Promise<void>;
    readonly home?: () => string;
    readonly temp?: () => string;
}
export declare const hostSafePathDeps: SafePathDeps;
export interface SafePathOptions {
    /** The configured value; empty means the default root. */
    readonly configured: string;
    readonly defaultRoot: string;
    /** Whether a missing root may be created, including the default root. */
    readonly create: boolean;
    /** Inspect readability rather than writability; never create a directory. */
    readonly readOnly?: boolean;
    /** Return the safe canonical candidate when it does not exist. */
    readonly allowMissing?: boolean;
    readonly deps?: SafePathDeps;
    /** Translate one refusal into the caller's domain error. */
    readonly refuse: (reason: string) => never;
}
/** Resolve one canonical root, checking the full path before touching disk. */
export declare function resolveSafeDirectoryPath(options: SafePathOptions): Promise<string>;
//# sourceMappingURL=safe-directory-path.d.ts.map