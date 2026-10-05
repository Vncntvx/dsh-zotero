/**
 * Type surface for `scripts/build-client.mjs`, so tests can drive the same
 * authority and handoff rules the build gates on.
 * @module scripts/build-client
 */

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
