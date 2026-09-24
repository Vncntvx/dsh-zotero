/**
 * The plugin's eight always-registered (read) tools, in the order
 * `ZoteroService` registers them (`registerSearchTool` …
 * `registerChangesTool`). The three write tools register only while
 * `writeEnabled` is on, so the composition spec's write-off baseline asserts
 * exactly this set. A ninth tool otherwise means editing every host spec
 * that names the set, and whichever one is missed keeps asserting a stale
 * list.
 *
 * The order is the source registration order, not a contract the assembled
 * registry owes: the composition spec sorts a copy because the Loader
 * resolves rows in dependency order, and the lifecycle spec walks the list
 * only to prove the prompt section names each tool.
 * @module tests/helpers/tool-names
 */

export const ZOTERO_TOOL_NAMES = [
  'zotero_search',
  'zotero_get',
  'zotero_children',
  'zotero_attachment',
  'zotero_retrieve',
  'zotero_export',
  'zotero_browse',
  'zotero_changes',
] as const
