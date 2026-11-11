/**
 * `dsh-zotero/enrichment` — the bundle component entry point.
 *
 * The Loader mounts the default export with the row's validated config. This
 * component exports exactly what an entry must: the service class (class-plugin
 * form), the config schema so a host can validate a section without
 * instantiating the service, and the config domain types. The transport, host
 * table, artifact store, credential resolver, and enhancer internals stay
 * internal.
 * @module dsh-zotero/enrichment
 */

export { default, EnrichmentService } from './service.js'
export { EnrichmentConfigSchema } from './config.js'
export type { EnrichmentConfig } from './config.js'
