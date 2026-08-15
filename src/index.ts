/**
 * dsh-zotero plugin entry: a Cordis Service plugin providing `ctx.zotero`.
 * The loader mounts the default export with the row's validated config; the
 * constructor registers the local provider, the `/zotero status` command,
 * and (in later phases) the model-facing tools and prompt guidance.
 * @module dsh-zotero
 */

export { default, ZoteroService } from './service.js'
export type * from './types.js'
export { ZoteroError, ZOTERO_INVALID_REF, ZOTERO_NOT_RUNNING, ZOTERO_SERVER_MISMATCH } from './errors.js'
