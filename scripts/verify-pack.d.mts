/** Type surface for the pack gate's pure helpers (unit-tested). */

/**
 * The JSON report carried by an `npm pack --json` stdout, with any lifecycle
 * script output ahead of it dropped.
 * @param stdout - the captured stdout of `npm pack --dry-run --json`.
 * @returns the JSON text to parse.
 * @throws {Error} when the stream carries no JSON payload at all.
 */
export declare function packReportOf(stdout: string): string

/**
 * Every packed path the manifest declares, plus the manifest claims the disk
 * cannot back (a declared locale wildcard with no bundle on disk).
 * @param manifest - the parsed `package.json`.
 * @param baseDir - the package root the wildcard patterns enumerate.
 * @returns the expected packed paths and the manifest-vs-disk problems.
 */
export declare function expectedPaths(
  manifest: Record<string, unknown>,
  baseDir?: string,
): { paths: string[]; problems: string[] }

/**
 * The packages a consumer's install would have to decide a build script for,
 * computed from the published runtime closure in the lockfile.
 * @param manifest - the parsed `package.json`; only runtime `dependencies` count.
 * @param lock - the parsed `package-lock.json`.
 * @returns sorted `name@version` labels for closure packages that declare a script.
 */
export declare function installScriptsInRuntimeClosure(
  manifest: Record<string, unknown>,
  lock: Record<string, unknown>,
): string[]
