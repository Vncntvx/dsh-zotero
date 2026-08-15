/**
 * dsh-zotero plugin entry: a Cordis Service plugin providing `ctx.zotero`.
 * The loader mounts the default export with the row's validated config; the
 * constructor registers the local provider, the five model-facing tools,
 * the `/zotero status` command, and the policy prompt section. The error
 * vocabulary (codes, `ZoteroError`, message constants) is part of the public
 * surface so consumers can route on typed failures.
 * @module dsh-zotero
 */

export { default, ZoteroService } from './service.js'
export type * from './types.js'
export * from './errors.js'
