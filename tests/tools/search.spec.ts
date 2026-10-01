/**
 * The `zotero_search` tool surface: the registered definition and schema, the
 * library/collection/publications scopes end to end, paging and supplemental
 * note-body matches, the rendered text, and the domain validations the
 * parameter schema cannot express.
 * @module tests/tools/search
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXCLUDE_TAGS_LITERAL_MESSAGE,
  INCLUDE_TRASHED_SCOPE_MESSAGE,
  ITEM_TYPES_LITERAL_MESSAGE,
  noteBodyMatchesMessage,
  renderSearch,
  SCOPE_REF_OR_NAME_MESSAGE,
  searchMoreMessage,
  TAGS_LITERAL_MESSAGE,
  TAG_MATCH_REQUIRES_TAGS_MESSAGE,
} from '../../src/tools/search.js'
import {
  GROUP_ID_MESSAGE,
  intRangeArgumentMessage,
  PERSONAL_LIBRARY_MESSAGE,
} from '../../src/tools/validate.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { collectionRow, searchHit } from '../helpers/server/objects.js'

let lane: HostLane
let mock: HostLane['mock']
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  mock = lane.mock
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

/**
 * The canonical search hit as the listing serves it. The search render reads
 * its title, creator summary, date, and item type, so those are spelled out
 * rather than left to the builder's defaults.
 */
const HIT = searchHit({
  meta: { creatorSummary: 'Dao, Tri', numChildren: 1 },
  data: {
    itemType: 'conferencePaper',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    tags: [],
    collections: [],
    relations: {},
  },
})

describe('zotero_search tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    const definition = lane.tool('zotero_search')
    expect(definition).toBeDefined()
    expect(lane.ctx.tools.schemas().some((schema) => schema.name === 'zotero_search')).toBe(true)
  })

  it('executes a library search and renders a compact list', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([HIT], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const result = expectValue(
      await runTool('zotero_search', { query: 'flash attention', limit: 5 }),
      'zotero_search',
    )
    expect(result.value).toEqual({
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      items: [
        {
          ref: 'zotero://user/0/item/ABCD1234?server=S1',
          title: 'FlashAttention-2',
          creatorSummary: 'Dao, Tri',
          year: 2023,
          itemType: 'conferencePaper',
        },
      ],
      total: 1,
      offset: 0,
      returned: 1,
    })
    expect(result.content[0]?.type).toBe('text')
    expect((result.content[0] as { text: string }).text).toBe(
      'Found 1 of 1 results:\n1. zotero://user/0/item/ABCD1234?server=S1 — FlashAttention-2 (2023) [conferencePaper] — Dao, Tri',
    )
  })

  it('renders the supplemental note list only when note-body matches exist', () => {
    const noteRow = {
      ref: 'zotero://user/0/item/NOTE1111',
      title: 'cascade note',
      creatorSummary: '',
      itemType: 'note',
    }
    const value = {
      scope: { kind: 'library' as const, library: { type: 'user' as const, id: 0 as const } },
      items: [],
      total: 42,
      offset: 0,
      returned: 2,
    }
    const withNotes = renderSearch(
      {},
      {
        ...value,
        supplemental: {
          kind: 'noteBody' as const,
          items: [noteRow, noteRow],
          scanned: 5,
          truncated: true,
        },
      },
    )
    expect((withNotes[0] as { text: string }).text).toContain(noteBodyMatchesMessage(2, 5, true))
    const completeScan = renderSearch(
      {},
      {
        ...value,
        supplemental: {
          kind: 'noteBody' as const,
          items: [{ ...noteRow, title: 'settled note', creatorSummary: 'Dao, Tri', year: 2024 }],
          scanned: 5,
          truncated: false,
        },
      },
    )
    expect((completeScan[0] as { text: string }).text).toContain(
      noteBodyMatchesMessage(1, 5, false),
    )
    expect((completeScan[0] as { text: string }).text).toContain(' — Dao, Tri')
    const withoutNotes = renderSearch({}, value)
    expect((withoutNotes[0] as { text: string }).text).not.toContain('note-body')
    const emptySupplement = renderSearch(
      {},
      {
        ...value,
        supplemental: { kind: 'noteBody' as const, items: [], scanned: 3, truncated: false },
      },
    )
    expect((emptySupplement[0] as { text: string }).text).not.toContain('note-body')
  })

  it('chains a resolved scope ref into the next page without re-resolving names', async () => {
    const collection = collectionRow()
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([collection], { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234', (req, res, helpers) =>
      helpers.json(collection, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/collections/COLL1234/items/top', (req, res, helpers) =>
      helpers.json([HIT], { 'Total-Results': '1', 'Zotero-Server-ID': 'S1' }),
    )
    const first = expectValue(
      await runTool('zotero_search', {
        scope: { kind: 'collection', refOrName: 'LLM Papers' },
      }),
      'zotero_search',
    )
    const scope = (first.value as { scope: { kind: string; ref: string } }).scope
    expect(scope).toEqual({
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL1234?server=S1',
      name: 'LLM Papers',
    })
    await runTool('zotero_search', {
      scope: { kind: 'collection', refOrName: scope.ref },
      offset: 10,
    })
    // The ref page fetches only that collection (for its name) — the full
    // listing is never re-requested after the name has been resolved once.
    expect(mock.requests.map((request) => request.pathname)).toEqual([
      '/api/users/0/collections',
      '/api/users/0/collections/COLL1234/items/top',
      '/api/users/0/collections/COLL1234',
      '/api/users/0/collections/COLL1234/items/top',
    ])
  })

  it('rejects a "||"-containing tag with a typed argument error', async () => {
    const result = await runTool('zotero_search', { query: 'x', tags: ['reviewed', 'a||b'] })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(TAGS_LITERAL_MESSAGE)
    expect(mock.requests).toEqual([])
  })

  it('rejects a limit above the configured maximum', async () => {
    const result = await runTool('zotero_search', { query: 'x', limit: 21 })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(
      intRangeArgumentMessage('limit', 21, 1, 20),
    )
  })

  it('rejects tagMatch without a tag filter', async () => {
    const result = await runTool('zotero_search', { query: 'x', tagMatch: 'any' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(TAG_MATCH_REQUIRES_TAGS_MESSAGE)
    expect(mock.requests).toEqual([])
  })

  it('rejects an empty scope refOrName and malformed item types', async () => {
    const emptyScope = await runTool('zotero_search', {
      scope: { kind: 'collection', refOrName: '  ' },
    })
    expect(emptyScope.isError).toBe(true)
    if (!emptyScope.isError) throw new Error('unreachable')
    expect((emptyScope.content[0] as { text: string }).text).toContain(SCOPE_REF_OR_NAME_MESSAGE)

    const badType = await runTool('zotero_search', { itemTypes: ['-attachment'] })
    expect(badType.isError).toBe(true)
    if (!badType.isError) throw new Error('unreachable')
    expect((badType.content[0] as { text: string }).text).toContain(ITEM_TYPES_LITERAL_MESSAGE)
  })

  it('announces further pages in the rendered output', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([HIT], { 'Total-Results': '25' }),
    )
    const result = expectValue(await runTool('zotero_search', { limit: 5 }), 'zotero_search')
    expect((result.content[0] as { text: string }).text).toContain(searchMoreMessage(1))
  })

  it('declares itself concurrency-safe', () => {
    const definition = lane.tool('zotero_search')!
    expect(definition.isConcurrencySafe?.({})).toBe(true)
  })

  it('passes valid item types through and marks PDF attachments in the render', async () => {
    const withPdf = {
      ...HIT,
      links: {
        self: {
          href: 'http://localhost:23119/api/users/0/items/ABCD1234',
          type: 'application/json',
        },
        attachment: {
          href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
          type: 'application/json',
          attachmentType: 'application/pdf',
        },
      },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([withPdf], { 'Total-Results': '1' }),
    )
    const result = expectValue(
      await runTool('zotero_search', {
        itemTypes: ['journalArticle', 'conferencePaper'],
        query: 'x',
      }),
      'zotero_search',
    )
    expect(mock.requests[0]!.search.get('itemType')).toBe('journalArticle || conferencePaper')
    expect((result.content[0] as { text: string }).text).toContain(' — PDF')
  })

  it('treats whitespace-only queries as omitted and rejects zero limits and blank tags', async () => {
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
    const blankQuery = await runTool('zotero_search', { query: '   ' })
    expectValue(blankQuery, 'zotero_search')
    expect(mock.requests[0]!.search.has('q')).toBe(false)

    const zeroLimit = await runTool('zotero_search', { limit: 0 })
    expect(zeroLimit.isError).toBe(true)
    if (!zeroLimit.isError) throw new Error('unreachable')
    expect((zeroLimit.content[0] as { text: string }).text).toContain(
      intRangeArgumentMessage('limit', 0, 1, 20),
    )

    const negativeOffset = await runTool('zotero_search', { offset: -1 })
    expect(negativeOffset.isError).toBe(true)
    if (!negativeOffset.isError) throw new Error('unreachable')
    expect((negativeOffset.content[0] as { text: string }).text).toContain(
      intRangeArgumentMessage('offset', -1, 0, 1_000_000),
    )

    const blankTag = await runTool('zotero_search', { tags: ['   '] })
    expect(blankTag.isError).toBe(true)
    if (!blankTag.isError) throw new Error('unreachable')
    expect((blankTag.content[0] as { text: string }).text).toContain(TAGS_LITERAL_MESSAGE)
  })

  it('renders missing years and creators without decoration', async () => {
    const bare = {
      ...HIT,
      meta: {},
      data: { ...HIT.data, creators: [] },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([bare], { 'Total-Results': '1' }),
    )
    const result = expectValue(await runTool('zotero_search', { query: 'x' }), 'zotero_search')
    expect((result.content[0] as { text: string }).text).toBe(
      'Found 1 of 1 results:\n1. zotero://user/0/item/ABCD1234 — FlashAttention-2 [conferencePaper]',
    )
  })
})

describe('zotero_search validation', () => {
  it('rejects domain-invalid tag filters and libraries through execute', async () => {
    // Shapes the parameter schema already rejects (unknown library type,
    // non-integer ids, invalid tagMatch enums) never reach these handlers;
    // these cases cover the domain constraints beyond the schema.
    const cases = [
      {
        args: { includeTrashed: true, scope: { kind: 'collection', refOrName: 'x' } },
        contains: INCLUDE_TRASHED_SCOPE_MESSAGE,
      },
      { args: { library: { type: 'user', id: 1 } }, contains: PERSONAL_LIBRARY_MESSAGE },
      { args: { library: { type: 'group', id: 0 } }, contains: GROUP_ID_MESSAGE },
      {
        args: { scope: { kind: 'publications' }, library: { type: 'group', id: 123 } },
        contains: 'My Publications scope is only valid for personal libraries.',
      },
      // A "||" in a tag is not a tag: the API joins literal tags with it, so
      // one embedded in a name would silently become two conditions.
      { args: { excludeTags: ['a||b'] }, contains: EXCLUDE_TAGS_LITERAL_MESSAGE },
    ]
    for (const c of cases) {
      const result = await runTool('zotero_search', c.args)
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toContain(c.contains)
    }
  })

  it('renders citation key in search results when available in extra', async () => {
    const withKey = {
      ...HIT,
      data: {
        ...HIT.data,
        extra: 'Citation Key: dao2023flash\nOther: field',
      },
    }
    mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (req, res, helpers) =>
      helpers.json([withKey], { 'Total-Results': '1' }),
    )
    const result = expectValue(await runTool('zotero_search', {}), 'zotero_search')
    expect((result.content[0] as { text: string }).text).toContain('[@dao2023flash]')
  })
})
