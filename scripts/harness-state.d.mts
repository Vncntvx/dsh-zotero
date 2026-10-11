/** Type surface for the harness-state CLI's pure helpers (unit-tested). */

export declare function versionMapBounds(lines: string[]): { start: number; end: number }

export declare const PROSE_VERSION_PATTERNS: RegExp[]

export declare function checkProseText(text: string, pin: string, path?: string): string[]

export declare function retargetProse(source: string, previous: string, next: string): string

export declare function checkVersionMap(
  path: string,
  source: string,
  packageVersion: string,
  pin: string,
): string[]

/**
 * Rewrite every harness face of a manifest to the pin (mutates `manifest`).
 * Dev/overrides take the exact pin; peers, engines, and harnessRange become >=pin.
 * @param manifest - parsed package.json.
 * @param version - the exact new pin.
 * @returns the same manifest.
 */
export declare function applyPinToManifest<T extends Record<string, unknown>>(
  manifest: T,
  version: string,
): T

/**
 * Every harness-face problem in a manifest relative to one exact pin.
 * @param manifest - parsed package.json.
 * @param pin - the exact pin every face must equal.
 * @returns human-readable problems; empty when every face satisfies its rule.
 */
export declare function collectPinFaceProblems(
  manifest: Record<string, unknown>,
  pin: string,
): string[]

/**
 * Every problem in a lockfile relative to the pin and the manifest's overrides.
 * @param lock - parsed package-lock.json.
 * @param manifest - parsed package.json.
 * @param pin - the exact pin every face must equal.
 * @returns human-readable problems; empty when lockfile matches pin and overrides is a superset.
 */
export declare function collectLockProblems(
  lock: Record<string, unknown>,
  manifest: Record<string, unknown> | undefined,
  pin: string,
): string[]

/**
 * Extracts the package name from a package-lock.json path key.
 * Handles nested node_modules (e.g. `node_modules/a/node_modules/b` -> `b`).
 * Returns undefined for paths outside node_modules, such as the root `""` or a workspace package.
 */
export declare function packageNameFromLockPath(path: string): string | undefined

/** One stale browser artifact: the package whose runtime bundle lags its declarations. */
export interface StaleClientRuntime {
  /** The `@deepseek-ai/*` package name. */
  readonly name: string
  /** The runtime bundle's path relative to the harness root. */
  readonly runtime: string
}

/** The categorized artifact findings; the caller decides what fails a run. */
export interface ArtifactProblems {
  /** Imported specifiers whose declarations are older than the package's `src`. */
  readonly stale: string[]
  /** Packages whose browser runtime is older than their own client declarations. */
  readonly staleRuntime: StaleClientRuntime[]
  /** Imported specifiers with no resolvable installed declaration. */
  readonly missing: string[]
  /** Imported specifiers that resolve outside the sibling harness checkout. */
  readonly outside: string[]
}

/**
 * Classify every imported upstream specifier against the sibling checkout's
 * installed artifacts, on both freshness axes: declarations versus `src`, and
 * the browser runtime versus its own client declarations.
 * @param harnessRoot - the sibling harness checkout root.
 * @param specifiers - every `@deepseek-ai/*` specifier this repository imports.
 * @returns the categorized findings.
 */
export declare function collectArtifactProblems(
  harnessRoot: string,
  specifiers: string[],
): ArtifactProblems
