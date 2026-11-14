/**
 * The inert library wire the browser-half apply world hands to the panel.
 *
 * Keeping these stubs outside `apply-world.ts` leaves that helper inside its
 * frozen size budget; every method returns an empty-but-valid answer, so no
 * spec here needs a real library.
 * @module tests/client/helpers/library-wire-stubs
 */

/** The wire reads/writes the library panel face forwards. */
export interface FakeLibraryWire {
  browse: (request: unknown) => Promise<unknown>
  search: (request: unknown) => Promise<unknown>
  item: (request: unknown) => Promise<unknown>
  childPage: (request: unknown) => Promise<unknown>
  collectionPath: (request: unknown) => Promise<unknown>
  export: (request: unknown) => Promise<unknown>
  write: (request: unknown) => Promise<unknown>
}

/** @returns the inert wire, with one stable item for the item endpoint. */
export function fakeLibraryWire(): FakeLibraryWire {
  return {
    collectionPath: async () => ({
      ok: true,
      value: { library: { type: 'user', id: 0 }, libraryVersion: 1, path: [] },
    }),
    export: async () => ({
      ok: true,
      value: {
        format: 'citation',
        citations: [{ ref: 'zotero://user/0/item/ABCD1234', text: 'Dao, T. (2023).' }],
      },
    }),
    browse: async () => ({
      ok: true,
      value: { kind: 'libraries', items: [], total: 0, offset: 0, returned: 0, limit: 50 },
    }),
    search: async () => ({
      ok: true,
      value: {
        scope: { kind: 'library', library: { type: 'user', id: 0 } },
        items: [],
        total: 0,
        offset: 0,
        returned: 0,
        limit: 50,
      },
    }),
    item: async () => ({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ABCD1234',
        itemType: 'journalArticle',
        title: 'Paper',
        creators: [],
        abstractTruncated: false,
        tags: [],
        collections: [],
        children: { total: 0 },
      },
    }),
    childPage: async () => ({
      ok: true,
      value: { kind: 'notes', page: { total: 0, returned: 0, offset: 0, limit: 50, items: [] } },
    }),
    write: async () => ({ ok: true, value: { kind: 'applied', message: 'done' } }),
  }
}
