/** Shape of one client-graph authority violation. */
export interface ClientGraphViolation {
  readonly kind: 'host-package' | 'host-local'
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
