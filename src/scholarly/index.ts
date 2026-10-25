/**
 * `dsh-zotero/scholarly` — the bundle component entry point.
 *
 * The Loader mounts the default export with the row's validated config, so this
 * module exports exactly what a component entry must:
 *
 * - the service class and its default export (the Loader's class-plugin form),
 * - the config schema, so a host can validate a section without instantiating
 *   the service,
 * - the domain types a consumer composes with.
 *
 * The transport, the host table, the store, the adapters, the fusion internals,
 * the tool factories, and the component's own prompt section stay internal.
 * They were all star-exported before, which made `readBounded`, `HostPacer`,
 * `DEFAULT_HOST_INTERVALS` and a dozen other implementation details
 * semver-visible through a published subpath. A same-package test reaches
 * internals by relative path (`../src/scholarly/...`), which is the documented
 * form; it never needs the public surface widened.
 *
 * @module dsh-zotero/scholarly
 */

export { default, ScholarlyService } from './service.js'
export type * from './types.js'
export { ScholarlyConfigSchema } from './config.js'
export type { ScholarlyConfig, ResolvedScholarlyConfig } from './config.js'
