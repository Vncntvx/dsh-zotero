/**
 * The plugin's tool-name vocabulary, single-sourced for every reader that
 * must stay in step with registration: the smoke check asserts the built
 * registry against it, and the host specs import the same constants instead
 * of hand-copied lists that rot when a tool joins.
 *
 * The write list stays in `constants.ts` (the model-facing policy and the
 * shell-write detector's audit copy quote it verbatim); this module derives
 * from it so a ninth write tool updates every consumer at once.
 * @module dsh-zotero/tools/names
 */
/** The write tools, as `reconcileWriteTools` registers them (gated by `writeEnabled`). */
export declare const ZOTERO_WRITE_TOOL_NAMES: readonly ["zotero_create_note", "zotero_update_item_tags", "zotero_update_item_collections", "zotero_create_collection", "zotero_delete_collection", "zotero_create_item", "zotero_update_item", "zotero_delete_library_tags"];
/** The eight read tools, in `ZoteroService` registration order (export and
 * `zotero_changes` register unconditionally; only their `run_in_background`
 * parameter waits on the jobs service). */
export declare const ZOTERO_READ_TOOL_NAMES: readonly ["zotero_search", "zotero_get", "zotero_children", "zotero_attachment", "zotero_retrieve", "zotero_export", "zotero_browse", "zotero_changes"];
/** Every tool the plugin can register, reads and writes together. */
export declare const ZOTERO_TOOL_NAMES: readonly ["zotero_search", "zotero_get", "zotero_children", "zotero_attachment", "zotero_retrieve", "zotero_export", "zotero_browse", "zotero_changes", "zotero_create_note", "zotero_update_item_tags", "zotero_update_item_collections", "zotero_create_collection", "zotero_delete_collection", "zotero_create_item", "zotero_update_item", "zotero_delete_library_tags"];
//# sourceMappingURL=names.d.ts.map