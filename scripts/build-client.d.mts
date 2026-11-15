/**
 * Type surface for `scripts/build-client.mjs`, so tests can drive the same
 * authority and handoff rules the build gates on.
 * @module scripts/build-client
 */

/**
 * The client bundle's byte ceiling. A bundle over it fails the build before
 * evaluation; raise it deliberately with a measured reason.
 */
export declare const MAX_CLIENT_BUNDLE_BYTES: number

/**
 * The module-loader API the bundle targets. The browser loader is a shell
 * global, so this constant is the repository's one statement of which handoff
 * shape it expects; `harness:pin` revisits it (DN-10).
 */
export declare const CLIENT_LOADER_API: 'legacy-stylesheet-tag' | 'meta-stylesheets'

/** The marker the legacy handoff injects; the meta API replaces it. */
export declare const LEGACY_STYLESHEET_MARKER: string

/**
 * Refuse a bundle built for the other loader API.
 * @param api - the `CLIENT_LOADER_API` value the build carries.
 * @param source - the produced bundle.
 * @returns void; throws when the two disagree.
 */
export declare function assertLoaderApi(
  api: 'legacy-stylesheet-tag' | 'meta-stylesheets',
  source: string,
): void

/** Verify a built bundle's loader handoff, external-only factory, and the
 * absence of host-schema artifact markers. Defaults to `lib/client.js`. */
export declare function verifyBundle(bundlePath?: string): void

/**
 * The esbuild plugin list the client graph carries. `verify: false` drops the
 * artifact-verify plugin (its default path is the real `lib/client.js`).
 */
export declare function clientBuildPlugins(options?: {
  verify?: boolean
}): import('esbuild').Plugin[]

/** Build the browser client bundle once, or keep a watch context alive. */
export declare function buildClientBundle(options?: { watch?: boolean }): Promise<void>
