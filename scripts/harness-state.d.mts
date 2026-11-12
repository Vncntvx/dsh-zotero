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
 * Every non-dsh `@deepseek-ai` dependency whose lock root declaration or
 * resolved version disagrees with the manifest. This is the vendor counterpart
 * of {@link collectLockProblems}: a manifest edited against a sibling HEAD's
 * vendor floor while the lock still carries the pinned release.
 * @param lock - parsed package-lock.json.
 * @param manifest - parsed package.json.
 * @returns human-readable problems; empty when every vendored dependency agrees.
 */
export declare function collectVendorLockProblems(
  lock: Record<string, unknown>,
  manifest: Record<string, unknown>,
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
  /** Harness packages the compiler resolves through a registry install. */
  readonly registry: RegistryInstall[]
}

/** One `@deepseek-ai/dsh-*` package installed from the registry, not the sibling checkout. */
export interface RegistryInstall {
  /** The package name as imported. */
  readonly name: string
  /** The resolved installed directory whose declarations typecheck reads. */
  readonly dir: string
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
 * The pure decision core of the mirrored client-dependency gate: every
 * mirrored name must be declared by the local manifest and its range floor
 * must equal one of the floors the sibling's client manifests declare at the
 * pin tag. Floors are compared, not range spellings.
 * @param mirrorNames - the mirrored names, shared with deps-check.
 * @param localRanges - mirrored name to the manifest's declared range.
 * @param siblingDecls - name to the ranges the sibling declares at the pin tag.
 * @returns problems (fatal) and notes (sibling-internal disagreements).
 */
export declare function clientDepsMirrorProblems(
  mirrorNames: ReadonlySet<string>,
  localRanges: ReadonlyMap<string, string>,
  siblingDecls: ReadonlyMap<string, readonly string[]>,
): { problems: string[]; notes: string[] }

/**
 * Classify every imported upstream specifier against the artifacts typecheck
 * actually resolves: sibling freshness when `node_modules` links into the
 * sibling checkout, installed-version provenance when it is a registry install.
 * @param harnessRoot - the sibling harness checkout root.
 * @param specifiers - every `@deepseek-ai/*` specifier this repository imports.
 * @param packages - pre-collected harness package map; collected when omitted.
 * @param installedRoot - the `node_modules` the compiler resolves through.
 * @returns the categorized findings.
 */
export declare function collectArtifactProblems(
  harnessRoot: string,
  specifiers: string[],
  packages?: ReadonlyMap<string, string>,
  installedRoot?: string,
): ArtifactProblems

/**
 * Every `@deepseek-ai/*` specifier this repository's sources and specs import.
 * Comments and string fixtures are excluded: a documented example is not a
 * dependency.
 * @returns the sorted, de-duplicated specifiers.
 */
export declare function importedSpecifiers(): string[]
