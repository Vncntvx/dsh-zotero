/**
 * The build identity of the client bundle: the package version and commit
 * stamped in by esbuild's `define` at build time (see
 * scripts/build-client.mjs). The constants exist only inside the built
 * bundle — the npm artifact ships its stamped values, and a plain module
 * environment (the test runner) degrades to `unknown` through the `typeof`
 * guards instead of throwing on the undeclared identifiers.
 * @module dsh-zotero/client/build-info
 */

/** The package version stamped into the bundle; `unknown` outside a built bundle. */
export function buildVersion(): string {
  return typeof __DSH_ZOTERO_VERSION__ === 'string' && __DSH_ZOTERO_VERSION__ !== ''
    ? __DSH_ZOTERO_VERSION__
    : 'unknown'
}

/** The commit short-id stamped into the bundle; `unknown` outside a built bundle. */
export function buildCommit(): string {
  return typeof __DSH_ZOTERO_COMMIT__ === 'string' && __DSH_ZOTERO_COMMIT__ !== ''
    ? __DSH_ZOTERO_COMMIT__
    : 'unknown'
}

/** The one-line display identity: version, middle dot, commit. */
export function buildInfoOf(): string {
  return `${buildVersion()} · ${buildCommit()}`
}
