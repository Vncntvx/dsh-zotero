/** Local-library identity fixtures shared by its annotation and availability specs. */
import type { ZoteroSearchResult } from '../../../src/types.js'
import type { ZoteroServiceLike } from '../../../src/scholarly/zotero-link.js'
import type { ScholarlyPaper } from '../../../src/scholarly/types.js'

/** A hit with just enough fields to be annotated. @param over - overrides. */
export function paperOf(over: Partial<ScholarlyPaper> = {}): ScholarlyPaper {
  return { title: 'Attention Is All You Need', authors: [], sources: [], ...over }
}

/**
 * A library service returning fixed compact records.
 * @param items - the records `search` returns.
 * @returns the service.
 */
export function libraryOf(items: ZoteroSearchResult['items']): ZoteroServiceLike {
  return {
    search: async () => ({
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      items,
      total: items.length,
      returned: items.length,
      offset: 0,
    }),
  }
}

/** One compact record the service can return. @param over - overrides. */
export function recordOf(over: Record<string, unknown> = {}) {
  return {
    ref: 'zotero://user/0/item/ITEM1234',
    title: 'Attention Is All You Need',
    creatorSummary: 'Vaswani et al.',
    itemType: 'journalArticle',
    ...over,
  } as ZoteroSearchResult['items'][number]
}
