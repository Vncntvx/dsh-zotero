/** Shape of one client-graph authority violation. */
export interface ClientGraphViolation {
  readonly kind: 'host-package' | 'host-local' | 'unknown-package'
  readonly key: string
  readonly detail: string
}

/** Allowlist regex for local sources the browser graph may value-import. */
export declare const CLIENT_SAFE_LOCAL: RegExp

/** Resolve-time filter for host-owned packages (zod). */
export declare const HOST_ONLY_PACKAGE_RESOLVE: RegExp

/** Metafile-input filter for host-owned packages (zod). */
export declare const HOST_ONLY_PACKAGE_INPUT: RegExp

/**
 * The third-party packages the bundle may carry inside itself; everything
 * else must be externalized.
 */
export declare const CLIENT_INLINE_PACKAGES: readonly string[]

/**
 * The package directory a metafile input belongs to, or undefined when the
 * input is not inside a `node_modules` tree. A nested dependency is judged
 * as the package that physically owns the file.
 * @param key - normalized metafile input key.
 * @returns the package name, e.g. `clsx` or `@acme/thing`.
 */
export declare function packageNameOf(key: string): string | undefined

/** Counterpart of tsdown `INLINE_SAFE` at dsh-v0.2.1-alpha.1. */
export declare const INLINE_SAFE: RegExp

/** Counterpart of tsdown `GENERATED_REMOTE` at dsh-v0.2.1-alpha.1. */
export declare const GENERATED_REMOTE: RegExp

/** Counterpart of tsdown `VENDORED_LIBRARY` at dsh-v0.2.1-alpha.1. */
export declare const VENDORED_LIBRARY: RegExp

/**
 * Whether a harness `@deepseek-ai/*` specifier may be inlined into the client bundle.
 * @param specifier - the import specifier as resolved.
 * @returns true when the harness purity rule allows an inline copy.
 */
export declare function isInlineSafeHarness(specifier: string): boolean

/**
 * Classify client-graph inputs against runtime authority.
 * @param inputs - esbuild `metafile.inputs` map.
 * @returns violations for inputs that may not ship in the browser bundle.
 */
export declare function clientGraphViolations(
  inputs: Record<string, unknown> | undefined,
): ClientGraphViolation[]

/** Minimal esbuild plugin face this authority plugin implements. */
export interface ClientAuthorityPlugin {
  readonly name: string
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      callback: (args: {
        path: string
        importer: string
      }) => { errors: { text: string }[] } | undefined,
    ): void
    onEnd(
      callback: (result: {
        errors: unknown[]
        metafile?: { inputs?: Record<string, unknown> }
      }) => { errors: { text: string }[] } | undefined,
    ): void
  }): void
}

/**
 * Create the client-graph authority esbuild plugin.
 * @returns plugin that fails host-package resolves and host-local metafile inputs.
 */
export declare function createClientAuthorityPlugin(): ClientAuthorityPlugin
