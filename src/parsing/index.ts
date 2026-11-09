/**
 * `dsh-zotero/parsing` — the bundle component entry point.
 *
 * The Loader mounts the default export with the row's validated config. This
 * component exports exactly what an entry must: the service class (class-plugin
 * form), the config schema so a host can validate a section without
 * instantiating the service, and the config domain types. The transport, host
 * table, artifact store, credential resolver, and enhancer internals stay
 * internal.
 * @module dsh-zotero/parsing
 */

export { default, ParsingService } from './service.js'
export { ParsingConfigSchema } from './config.js'
export type { ParsingConfig } from './config.js'
