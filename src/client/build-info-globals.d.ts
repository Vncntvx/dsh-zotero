/**
 * Build-time globals stamped into the client bundle by esbuild's `define`
 * (see scripts/build-client.mjs). They exist only inside the built bundle;
 * un-built environments (the test runner) must read them through the
 * `typeof` guards in build-info.ts.
 */

/** The package version the bundle was built from. */
declare const __DSH_ZOTERO_VERSION__: string

/** The commit short-id the bundle was built from, or `unknown`. */
declare const __DSH_ZOTERO_COMMIT__: string
