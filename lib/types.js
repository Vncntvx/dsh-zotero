/**
 * Zotero domain vocabulary for the dsh-zotero plugin.
 *
 * Model-facing tools exchange {@link ZoteroObjectRef}s serialized as
 * `zotero://user/0/item/<KEY>` strings, optionally carrying the serving
 * instance's identity as a provenance qualifier
 * (`?server=<Zotero-Server-ID>`). Everything in this module is a plain
 * lossless-JSON-safe DTO; tool `execute` bodies return these values directly.
 * The one exception is {@link ZoteroWriteCall}, which carries the asking tool
 * run (agent, signal, tool name, call id) into the seam and never crosses the
 * wire.
 * @module dsh-zotero/types
 */
export { ZOTERO_CREATABLE_ITEM_TYPES, ZOTERO_UPDATABLE_ITEM_FIELDS } from './constants.js';
//# sourceMappingURL=types.js.map