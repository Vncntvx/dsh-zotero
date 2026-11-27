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
 * Verify a built bundle's loader handoff, external-only factory, and the
 * stylesheet metadata. Defaults to `lib/client.js`.
 */
export declare function verifyBundle(bundlePath?: string): void

/**
 * The esbuild plugin list the client graph carries. `verify: false` skips
 * production bundle assembly and verification.
 */
export declare function clientBuildPlugins(options?: {
  verify?: boolean
}): import('esbuild').Plugin[]

/** Build the browser client bundle once, or keep a watch context alive. */
export declare function buildClientBundle(options?: { watch?: boolean }): Promise<void>
export const readerUiPackPaths: readonly string[]
export const parsedDocumentPackPaths: readonly string[]
