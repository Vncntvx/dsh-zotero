/**
 * The wire objects the mocked Zotero Local API serves.
 *
 * These are builders rather than frozen constants because the specs vary the
 * same object in different directions: a listing hit carries a `library`
 * block and `data.key` that a single-item read does not, a retrieval parent
 * carries an abstract that a children walk does not care about. A constant
 * would force one of those to be wrong; a builder lets each spec name the
 * fields its behavior needs and inherit everything else from one definition.
 *
 * The base defaults are deliberately **minimal**: identity, an item type, a
 * title, a self link. Anything a spec does not ask for is not on the wire, so
 * a field can never arrive in a test by accident. That matters most for the
 * `fields: 'all'` pass-through tests, where an unconsumed field the fixture
 * added on its own shows up as extra output and fails the test for the wrong
 * reason.
 *
 * The named presets (`paperItem`, `searchHit`) exist because those two shapes
 * genuinely repeat across specs; they are the single definition of a shape
 * that used to be copied seven times.
 * @module tests/helpers/server/objects
 */

import { ATTACHMENT_KEY, COLLECTION_KEY, ITEM_KEY, SERVER_ID } from './keys.js'

/** One Zotero object as the Local API serializes it. */
export interface WireObject {
  readonly key: string
  readonly version: number
  readonly links?: Record<string, unknown>
  readonly meta?: Record<string, unknown>
  readonly library?: Record<string, unknown>
  readonly data: Record<string, unknown>
}

/** The self link the API serves for one object. */
function selfLink(path: string): Record<string, unknown> {
  return { href: `http://localhost:23119${path}`, type: 'application/json' }
}

/** Overrides for one wire object: each section merges over the base, arrays replace it. */
export interface ObjectOverrides {
  readonly key?: string
  readonly version?: number
  readonly links?: Record<string, unknown>
  readonly meta?: Record<string, unknown>
  readonly library?: Record<string, unknown>
  readonly data?: Record<string, unknown>
}

/**
 * A bibliographic item with only its identity on the wire. Every other field
 * comes from the caller, so a test that needs a date says so.
 * @param overrides - the sections to override.
 * @returns the wire object.
 */
export function item(overrides: ObjectOverrides = {}): WireObject {
  const key = overrides.key ?? ITEM_KEY
  return {
    key,
    version: overrides.version ?? 3,
    ...(overrides.library === undefined ? {} : { library: overrides.library }),
    links: {
      self: selfLink(`/api/users/0/items/${key}`),
      ...overrides.links,
    },
    meta: { parsedDate: '2023-07-28', ...overrides.meta },
    data: {
      itemType: 'journalArticle',
      title: 'FlashAttention-2',
      ...overrides.data,
    },
  }
}

/**
 * The canonical paper as the read paths see it: dated, attributed, published
 * at ICML, carrying one tag and one collection, and pointing at its PDF. This
 * is the shape `getItem` and `retrieve` specs share.
 * @param overrides - the sections to override.
 * @returns the wire object.
 */
export function paperItem(overrides: ObjectOverrides = {}): WireObject {
  return item({
    ...overrides,
    links: {
      attachment: {
        href: `http://localhost:23119/api/users/0/items/${ATTACHMENT_KEY}`,
        type: 'application/json',
        attachmentType: 'application/pdf',
      },
      ...overrides.links,
    },
    meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', ...overrides.meta },
    data: {
      date: '2023-07-28',
      creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
      publicationTitle: 'ICML',
      tags: [],
      collections: [],
      ...overrides.data,
    },
  })
}

/**
 * The same paper as a **listing** serves it: Zotero adds the owning library
 * block and repeats `key`/`version` inside `data`, and a search hit carries no
 * attachment link. The listing shape is what the search and browse paths
 * normalize.
 * @param overrides - the sections to override.
 * @returns the wire object.
 */
export function searchHit(overrides: ObjectOverrides = {}): WireObject {
  const key = overrides.key ?? ITEM_KEY
  return item({
    ...overrides,
    version: overrides.version ?? 3,
    library: { type: 'user', id: 999, name: 'user', links: {}, ...overrides.library },
    data: { key, version: overrides.version ?? 3, ...overrides.data },
  })
}

/**
 * An attachment row. Its `parentItem` is what makes the ownership provable, so
 * callers pass it when the attachment is meant to belong to an item.
 * @param overrides - the sections to override.
 * @returns the wire object.
 */
export function attachment(overrides: ObjectOverrides = {}): WireObject {
  const key = overrides.key ?? ATTACHMENT_KEY
  return {
    key,
    version: overrides.version ?? 1,
    links: { self: selfLink(`/api/users/0/items/${key}`), ...overrides.links },
    data: {
      itemType: 'attachment',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
      linkMode: 'imported_file',
      ...overrides.data,
    },
  }
}

/**
 * A note row. `parentItem` is deliberately **not** defaulted: a note is
 * sometimes served as a standalone item and sometimes as a child, and the
 * specs legitimately cover both. A note record's `parentRef` follows from what
 * the caller passes here.
 * @param overrides - the sections to override.
 * @returns the wire object.
 */
export function noteRow(overrides: ObjectOverrides = {}): WireObject {
  return {
    key: overrides.key ?? 'NOTE1111',
    version: overrides.version ?? 1,
    data: { itemType: 'note', note: 'my note', ...overrides.data },
  }
}

/**
 * An annotation row. Unlike a note, an annotation always hangs off the
 * attachment it marks up (Zotero stores them as children of the PDF, never of
 * the bibliographic item), so the canonical shape carries that ownership
 * rather than leaving it to each caller to remember. The specs that assert a
 * `parentRef` depend on it, and the one that does not still gets a real object.
 * @param overrides - the sections to override.
 * @returns the wire object.
 */
export function annotationRow(overrides: ObjectOverrides = {}): WireObject {
  return {
    key: overrides.key ?? 'ANNO1111',
    version: overrides.version ?? 1,
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'insight',
      annotationSortIndex: '00001',
      parentItem: ATTACHMENT_KEY,
      ...overrides.data,
    },
  }
}

/** A collection row as the collections listing serves it. */
export function collectionRow(overrides: ObjectOverrides = {}): WireObject {
  const key = overrides.key ?? COLLECTION_KEY
  return {
    key,
    version: overrides.version ?? 1,
    data: { key, version: overrides.version ?? 1, name: 'LLM Papers', ...overrides.data },
  }
}

/** A saved-search row with its stored conditions. */
export function savedSearchRow(overrides: ObjectOverrides = {}): WireObject {
  const key = overrides.key ?? 'SRCH1234'
  return {
    key,
    version: overrides.version ?? 1,
    data: {
      key,
      version: overrides.version ?? 1,
      name: 'Unread Papers',
      conditions: [],
      ...overrides.data,
    },
  }
}

/**
 * One row of a citation export: an item key with the citation text Zotero
 * rendered for it. The export path pairs rows with the refs it asked about and
 * reorders them to the caller's order, so the pairing (not the row's position
 * in the response) is the fact under test.
 * @param key - the item key the citation belongs to.
 * @param citation - the rendered citation text.
 * @returns the wire row.
 */
export function citationRow(key: string, citation: string): { key: string; citation: string } {
  return { key, citation }
}

/**
 * The headers a versioned response carries: the instance that answered and the
 * library version it answered at.
 * @param serverId - the answering instance.
 * @param version - the library version to report.
 * @returns the headers to hand to a route handler.
 */
export function versionHeaders(
  serverId: string = SERVER_ID,
  version?: number,
): Record<string, string> {
  return {
    'Zotero-Server-ID': serverId,
    ...(version === undefined ? {} : { 'Last-Modified-Version': String(version) }),
  }
}
