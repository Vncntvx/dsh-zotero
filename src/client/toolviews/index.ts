/**
 * Zotero client toolviews: dedicated Chat cards for all 11 Zotero tools.
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

const REGISTRATIONS = [
  ['zotero_search', SearchToolView],
  ['zotero_retrieve', RetrieveToolView],
  ['zotero_export', ExportToolView],
  ['zotero_get', ItemToolView],
  ['zotero_children', ChildrenToolView],
  ['zotero_attachment', ChildrenToolView],
  ['zotero_create_note', WriteToolView],
  ['zotero_add_tags', WriteToolView],
  ['zotero_add_to_collection', WriteToolView],
  ['zotero_browse', BrowseToolView],
  ['zotero_changes', BrowseToolView],
] as const

/**
 * Register all 11 Zotero tool views into the `tool.call.toolview` keyed slot.
 * @param ctx - browser plugin context.
 */
export function registerZoteroToolviews(ctx: ClientContext): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const [key, component] of REGISTRATIONS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: 'zotero' }, component)
    }
  })
}
