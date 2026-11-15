/**
 * The library panel's shared wire fixtures: one connected probe answer, the
 * three browse listings, two list pages, and one full item detail. They live
 * apart from `mountPanel` so the harness stays a mounted surface, not a shelf
 * of literals.
 * @module tests/client/helpers/library-panel-fixtures
 */

import type {
  ZoteroItemDetailView,
  ZoteroLibraryBrowseResultView,
  ZoteroSearchResultView,
  ZoteroStatusView,
} from '../../../src/client/remote.ts'
import { statusView } from '../../helpers/status-view.ts'

/** A connected probe answer. */
export const CONNECTED: ZoteroStatusView = statusView({ apiVersion: '3', serverId: 'S1' })

/** One personal-library option and one group option. */
export const LIBRARY_ROWS: ZoteroLibraryBrowseResultView = {
  kind: 'libraries',
  items: [
    { kind: 'library', library: { type: 'user', id: 0 }, name: 'My Library' },
    { kind: 'library', library: { type: 'group', id: 123 }, name: 'Lab Reading' },
  ],
  total: 2,
  offset: 0,
  returned: 2,
  limit: 2,
}

/** Root collections with a parent/child pair, plus one saved search. */
export const ROOT_COLLECTIONS: ZoteroLibraryBrowseResultView = {
  kind: 'collections',
  libraryVersion: 1,
  items: [
    {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0001',
      name: 'LLM Papers',
      path: ['LLM Papers'],
      depth: 0,
    },
    {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0002',
      name: 'Reasoning',
      path: ['Reasoning'],
      depth: 0,
    },
  ],
  total: 2,
  offset: 0,
  returned: 2,
  limit: 2,
}

export const CHILD_COLLECTIONS: ZoteroLibraryBrowseResultView = {
  kind: 'collections',
  libraryVersion: 1,
  items: [
    {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0011',
      name: 'Attention',
      parentRef: 'zotero://user/0/collection/COLL0001',
      path: ['LLM Papers', 'Attention'],
      depth: 1,
    },
  ],
  total: 1,
  offset: 0,
  returned: 1,
  limit: 1,
}

export const SAVED_SEARCHES: ZoteroLibraryBrowseResultView = {
  kind: 'savedSearches',
  libraryVersion: 1,
  items: [
    { kind: 'savedSearch', ref: 'zotero://user/0/search/SEARCH01', name: 'Unread', conditions: [] },
  ],
  total: 1,
  offset: 0,
  returned: 1,
  limit: 1,
}

/**
 * One full page of library hits. The first row carries the structured authors
 * and the venue the list renders; its `creatorSummary` is Zotero's own
 * locale-formatted string, so a spec can prove the row ignores it.
 */
export function searchPage(
  overrides: Partial<ZoteroSearchResultView> = {},
): ZoteroSearchResultView {
  return {
    scope: { kind: 'library', library: { type: 'user', id: 0 } },
    items: [
      {
        ref: 'zotero://user/0/item/ITEM0001',
        title: 'FlashAttention-2',
        creatorSummary: 'Dao和Tri',
        authors: ['Tri Dao'],
        venue: 'NeurIPS',
        year: 2023,
        itemType: 'conferencePaper',
      },
      {
        ref: 'zotero://user/0/item/ITEM0002',
        title: 'Tree of Thoughts',
        creatorSummary: 'Yao',
        authors: ['Shunyu Yao'],
        year: 2023,
        itemType: 'conferencePaper',
      },
    ],
    total: 2,
    offset: 0,
    returned: 2,
    limit: 2,
    ...overrides,
  }
}

/** One item detail with all three child listings. */
export const ITEM_DETAIL: ZoteroItemDetailView = {
  ref: 'zotero://user/0/item/ITEM0001',
  itemType: 'conferencePaper',
  title: 'FlashAttention-2',
  creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
  date: '2023',
  year: 2023,
  venue: 'NeurIPS',
  doi: '10.0/example',
  abstract: 'Faster attention.',
  abstractTruncated: false,
  tags: ['attention'],
  collections: [{ ref: 'zotero://user/0/collection/COLL0001', name: 'LLM Papers' }],
  children: { total: 2 },
  notes: {
    offset: 0,
    total: 1,
    returned: 1,
    limit: 1,
    items: [{ ref: 'zotero://user/0/item/NOTE0001', text: 'idea', truncated: false }],
  },
  attachments: {
    offset: 0,
    total: 1,
    returned: 1,
    limit: 1,
    items: [
      {
        ref: 'zotero://user/0/item/ATTAC001',
        title: 'paper.pdf',
        contentType: 'application/pdf',
      },
    ],
  },
  annotations: {
    offset: 0,
    total: 1,
    returned: 1,
    limit: 1,
    items: [
      {
        ref: 'zotero://user/0/item/ANNO0001',
        type: 'highlight',
        text: 'faster',
        pageLabel: '3',
      },
    ],
  },
}
