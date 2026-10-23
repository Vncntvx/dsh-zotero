/**
 * Zotero client toolviews: dedicated Chat cards for every registered Zotero tool.
 * @module dsh-zotero/client/toolviews
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ZOTERO_REMOTE_PACKAGE } from '../../contract.js'
import { withCardBoundary } from './ZoteroCardBoundary.tsx'
import { SearchToolView } from './SearchToolView.tsx'
import { RetrieveToolView } from './RetrieveToolView.tsx'
import { ExportToolView } from './ExportToolView.tsx'
import { ItemToolView } from './ItemToolView.tsx'
import { ChildrenToolView } from './ChildrenToolView.tsx'
import { WriteToolView } from './WriteToolView.tsx'
import { BrowseToolView } from './BrowseToolView.tsx'

/**
 * Every model tool's card, keyed by the wire tool name. Exported so a spec can
 * walk the same table the plugin registers from, so a tool added here without a
 * card, or a card added without a tool, has to show up in one place.
 */
export const REGISTRATIONS = [
  ['zotero_search', SearchToolView],
  ['zotero_retrieve', RetrieveToolView],
  ['zotero_export', ExportToolView],
  ['zotero_get', ItemToolView],
  ['zotero_children', ChildrenToolView],
  ['zotero_attachment', ChildrenToolView],
  ['zotero_create_note', WriteToolView],
  ['zotero_batch_items', WriteToolView],
  ['zotero_update_note', WriteToolView],
  ['zotero_update_item_tags', WriteToolView],
  ['zotero_update_item_collections', WriteToolView],
  ['zotero_create_collection', WriteToolView],
  ['zotero_update_collection', WriteToolView],
  ['zotero_delete_collection', WriteToolView],
  ['zotero_create_item', WriteToolView],
  ['zotero_update_item', WriteToolView],
  ['zotero_restore_items', WriteToolView],
  ['zotero_create_saved_search', WriteToolView],
  ['zotero_update_saved_search', WriteToolView],
  ['zotero_delete_saved_search', WriteToolView],
  ['scholarly_save_to_zotero', WriteToolView],
  ['zotero_delete_library_tags', WriteToolView],
  ['zotero_browse', BrowseToolView],
  ['zotero_changes', BrowseToolView],
] as const

/**
 * The registrant stamped on every tool-card entry: the harness's own ownership
 * field, declared explicitly so the client crash intake claims every entry in
 * the registration table (`registry.ts` stamps `options.registrant ?? ctx.fiber?.name`).
 */
const REGISTRANT = ZOTERO_REMOTE_PACKAGE

/**
 * Register all Zotero tool views into the `tool.call.toolview` keyed slot.
 * @param ctx - browser plugin context.
 */
export function registerZoteroToolviews(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const [key, component] of REGISTRATIONS) {
      yield ctx.slots.register(
        { name: 'tool.call.toolview', key, locale: 'zotero', registrant: REGISTRANT },
        withCardBoundary(component),
      )
    }
  })
}
