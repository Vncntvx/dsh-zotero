/**
 * Zotero client toolviews: dedicated Chat cards for all 16 Zotero tools.
 * @module dsh-zotero/client/toolviews
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SearchToolView } from './SearchToolView.tsx'
import { RetrieveToolView } from './RetrieveToolView.tsx'
import { ExportToolView } from './ExportToolView.tsx'
import { ItemToolView } from './ItemToolView.tsx'
import { ChildrenToolView } from './ChildrenToolView.tsx'
import { WriteToolView } from './WriteToolView.tsx'
import { BrowseToolView } from './BrowseToolView.tsx'

/**
 * Every model tool's card, keyed by the wire tool name. Exported so a spec can
 * walk the same table the plugin registers from — a tool added here without a
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
  ['zotero_update_item_tags', WriteToolView],
  ['zotero_update_item_collections', WriteToolView],
  ['zotero_create_collection', WriteToolView],
  ['zotero_delete_collection', WriteToolView],
  ['zotero_create_item', WriteToolView],
  ['zotero_update_item', WriteToolView],
  ['zotero_delete_library_tags', WriteToolView],
  ['zotero_browse', BrowseToolView],
  ['zotero_changes', BrowseToolView],
] as const

/**
 * Register all 16 Zotero tool views into the `tool.call.toolview` keyed slot.
 * @param ctx - browser plugin context.
 */
export function registerZoteroToolviews(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const [key, component] of REGISTRATIONS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: 'zotero' }, component)
    }
  })
}
