/** Type surface for the harness-state CLI's pure helpers (unit-tested). */

/**
 * Rewrite every harness face of a manifest to the pin (mutates `manifest`).
 * Dev/overrides take the exact pin; peers and engines become >=pin. The
 * manifest carries no other derived face: `dsh.harnessRange` was a
 * self-invented field the runtime never read, and `collectPinFaceProblems`
 * refuses it rather than rewriting it.
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
 * Every vendored framework dependency whose declared floor is not the version
 * the sibling checkout carries, plus every vendored package named in
 * `overrides`.
 *
 * Vendored packages (`cordis`, `cosmokit`, `schemastery`, `cordis-plugin-*`)
 * are published from the sibling's `vendor/` tree and version independently of
 * the harness release, so the pin does not cover them. A `^X.Y.Z-alpha.N` floor
 * resolves to the prerelease even after upstream ships `X.Y.Z`, and the profile
 * then loads two copies of the same framework package. The floor agreement is
 * only expressible in `dependencies` / `devDependencies` / `peerDependencies`,
 * so an `overrides` entry naming a vendored package is a finding on its own:
 * every other check skips non-`dsh-*` names, and nothing else would catch it.
 *
 * A missing or empty sibling checkout yields no findings: nothing was installed
 * to compare against, which is a note rather than a failure.
 * @param harnessRoot - the sibling harness checkout root.
 * @param manifest - parsed package.json.
 * @returns human-readable problems; empty when every vendored dependency agrees.
 */
export declare function collectVendorProblems(
  harnessRoot: string,
  manifest: Record<string, unknown>,
): string[]

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
