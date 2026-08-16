/**
 * Wire-level item fixtures shared by the provider and tool specs. The raw
 * Zotero Local API objects are byte-identical across the specs that drive
 * the real HTTP path; keeping one copy prevents the two suites from drifting
 * apart on the same mocked response shapes. Specs that need a richer or
 * leaner shape (a parent with an abstract, a retrieval with page labels)
 * keep their own inline fixtures.
 * @module tests/helpers/fixtures
 */

/** One compact search-hit item as the Local API serves it. */
export const ITEM = {
  key: 'ABCD1234',
  version: 3,
  library: { type: 'user', id: 999, name: 'user', links: {} },
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
  },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 1 },
  data: {
    key: 'ABCD1234',
    version: 3,
    itemType: 'conferencePaper',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    tags: [],
    collections: [],
    relations: {},
  },
}

/** The note/annotation/attachment child rows of the shared parent item. */
export const CHILD_ROWS = [
  { key: 'NOTE1111', data: { itemType: 'note', note: 'my note' } },
  {
    key: 'ANNO1111',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'insight',
      annotationSortIndex: '00001',
    },
  },
  {
    key: 'WXYZ6789',
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
    },
  },
]
