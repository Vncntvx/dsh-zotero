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
