/**
 * The `zotero_get` tool surface: metadata reads with lazy children, notes,
 * annotations, attachments and collection names, the item render, and the
 * ref and argument checks that fail before any request.
 * @module tests/tools/get
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectedKindRefMessage, invalidRefMessage } from '../../src/refs.js'
import { renderGet } from '../../src/tools/get.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { serveChildrenContract } from '../helpers/server/children-contract.js'
import { annotationRow, attachment, collectionRow, noteRow } from '../helpers/server/objects.js'

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

const GET_PARENT = {
  key: 'ABCD1234',
  version: 3,
  links: {
    self: { href: 'http://localhost:23119/api/users/0/items/ABCD1234', type: 'application/json' },
    attachment: {
      href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
      type: 'application/json',
      attachmentType: 'application/pdf',
    },
  },
  meta: { creatorSummary: 'Dao, Tri', parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    date: '2023-07-28',
    creators: [{ creatorType: 'author', firstName: 'Tri', lastName: 'Dao' }],
    publicationTitle: 'ICML',
    DOI: '10.1234/fa2',
    url: 'https://arxiv.org/abs/2307.08691',
    abstractNote: 'FlashAttention is fast.',
    tags: [{ tag: 'attention' }, { tag: 'efficient' }],
    collections: ['COLL1234', 'COLL9999'],
  },
}

describe('zotero_get tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    expect(lane.tool('zotero_get')).toBeDefined()
    expect(lane.ctx.tools.schemas().some((schema) => schema.name === 'zotero_get')).toBe(true)
  })

  it('reads metadata with a single request by default', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(
        {
          ...GET_PARENT,
          links: { self: GET_PARENT.links.self },
          data: { ...GET_PARENT.data, collections: [] },
        },
        { 'Zotero-Server-ID': 'S1' },
      ),
    )
    const result = expectValue(
      await runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' }),
      'zotero_get',
    )
    expect(mock.requests.map((request) => request.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
    ])
    expect(result.value).toMatchObject({
      ref: 'zotero://user/0/item/ABCD1234?server=S1',
      title: 'FlashAttention-2',
      year: 2023,
      collections: [],
      children: { total: 3 },
    })
    expect(result.content[0]?.type).toBe('text')
    expect((result.content[0] as { text: string }).text).toBe(
      [
        'zotero://user/0/item/ABCD1234?server=S1 — FlashAttention-2 (2023) [journalArticle]',
        'Creators: Tri Dao',
        'ICML · 2023-07-28 · DOI: 10.1234/fa2',
        'URL: https://arxiv.org/abs/2307.08691',
        'Tags: attention, efficient',
        'Abstract: FlashAttention is fast.',
        'Children: 3 total',
      ].join('\n'),
    )
  })

  it('passes unconsumed fields through extraFields under fields:"all"', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        version: 3,
        data: {
          itemType: 'dataset',
          title: 'Replication data',
          repository: 'Zenodo',
          libraryCatalog: 'Zotero',
        },
      }),
    )
    const result = expectValue(
      await runTool('zotero_get', {
        ref: 'zotero://user/0/item/ABCD1234',
        fields: 'all',
      }),
      'zotero_get',
    )
    const value = result.value as { extraFields?: Record<string, unknown> }
    expect(value.extraFields).toEqual({ repository: 'Zenodo', libraryCatalog: 'Zotero' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Additional fields: libraryCatalog: Zotero; repository: Zenodo')
  })

  it('renders a bare item without decorations', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        key: 'ABCD1234',
        data: { itemType: 'journalArticle', title: 'Bare' },
      }),
    )
    const result = expectValue(
      await runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' }),
      'zotero_get',
    )
    expect((result.content[0] as { text: string }).text).toBe(
      'zotero://user/0/item/ABCD1234 — Bare [journalArticle]\nChildren: 0 total',
    )
  })

  it('includes children and collection names on request', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(GET_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    serveChildrenContract(mock, '/api/users/0/items/ABCD1234/children', {
      direct: [noteRow(), attachment()],
      annotations: [annotationRow()],
    })
    mock.route('GET', '/api/users/0/collections', (req, res, helpers) =>
      helpers.json([collectionRow()]),
    )
    const result = expectValue(
      await runTool('zotero_get', {
        ref: 'zotero://user/0/item/ABCD1234',
        include: ['notes', 'annotations', 'attachments'],
      }),
      'zotero_get',
    )
    // Parent first; the two children contracts and the collections listing
    // are independent once the parent has arrived.
    const lines = mock.requests.map((request) => {
      const query = request.search.toString()
      return query === '' ? request.pathname : `${request.pathname}?${query}`
    })
    expect(lines[0]).toBe('/api/users/0/items/ABCD1234')
    expect(lines.slice(1).sort()).toEqual(
      [
        '/api/users/0/items/ABCD1234/children',
        '/api/users/0/items/ABCD1234/children?itemType=annotation',
        '/api/users/0/collections',
      ].sort(),
    )
    const value = result.value as {
      collections: { ref: string; name?: string }[]
      notes: { returned: number }
      annotations: { returned: number }
      attachments: { returned: number }
      bestAttachment: { title: string; contentType: string }
    }
    expect(value.collections).toEqual([
      { ref: 'zotero://user/0/collection/COLL1234?server=S1', name: 'LLM Papers' },
      { ref: 'zotero://user/0/collection/COLL9999?server=S1' },
    ])
    expect(value.notes.returned).toBe(1)
    expect(value.annotations.returned).toBe(1)
    expect(value.attachments.returned).toBe(1)
    expect(value.bestAttachment).toEqual({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: 'Full Text PDF',
      contentType: 'application/pdf',
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain(
      'Children: 3 total (1 of 1 notes; 1 of 1 annotations; 1 of 1 attachments)',
    )
    expect(text).toContain('Collections: LLM Papers, zotero://user/0/collection/COLL9999?server=S1')
    expect(text).toContain(
      'Best attachment: zotero://user/0/attachment/WXYZ6789?server=S1 (application/pdf)',
    )
  })

  it('flags truncated abstracts and attachment content types without a label', async () => {
    const longAbstract = 'a'.repeat(3001)
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        ...GET_PARENT,
        links: {
          attachment: {
            href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
            type: 'application/json',
          },
        },
        data: {
          ...GET_PARENT.data,
          collections: [],
          creators: [],
          abstractNote: longAbstract,
          publicationTitle: '',
          DOI: '',
          url: '',
          date: '',
          tags: [],
        },
      }),
    )
    const result = expectValue(
      await runTool('zotero_get', { ref: 'zotero://user/0/item/ABCD1234' }),
      'zotero_get',
    )
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Abstract (truncated): ')
    expect(text).toContain('Best attachment: zotero://user/0/attachment/WXYZ6789 (unknown type)')
    expect(text).not.toContain('Creators:')
    expect(text).not.toContain('Tags:')
    expect(text).not.toContain('URL:')
  })

  it('rejects malformed and wrong-kind refs before any request', async () => {
    const malformed = await runTool('zotero_get', { ref: 'ABCD1234' })
    expect(malformed.isError).toBe(true)
    if (!malformed.isError) throw new Error('unreachable')
    expect((malformed.content[0] as { text: string }).text).toContain(invalidRefMessage('ABCD1234'))

    const wrongKind = await runTool('zotero_get', { ref: 'zotero://user/0/collection/COLL1234' })
    expect(wrongKind.isError).toBe(true)
    if (!wrongKind.isError) throw new Error('unreachable')
    expect((wrongKind.content[0] as { text: string }).text).toContain(
      expectedKindRefMessage(['item'], 'collection'),
    )

    expect(mock.requests).toEqual([])
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      lane.tool('zotero_get')!.isConcurrencySafe?.({ ref: 'zotero://user/0/item/ABCD1234' }),
    ).toBe(true)
  })
})

describe('zotero_get render', () => {
  function render(value: never): string {
    return (renderGet({} as never, value)[0] as { text: string }).text
  }

  it('omits the additional-fields line when every extra field is undefined', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'dataset',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      extraFields: { ghost: undefined },
    } as never)
    expect(text).not.toContain('Additional fields')
  })

  it('JSON-encodes non-string extra field values', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      itemType: 'dataset',
      title: 'T',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      extraFields: { versionNumber: 2, flags: ['a', true] },
    } as never)
    expect(text).toContain('versionNumber: 2')
    expect(text).toContain('flags: ["a",true]')
  })

  it('renders the note body with a truncation marker for note items', () => {
    const truncated = render({
      ref: 'zotero://user/0/item/NOTE1111',
      itemType: 'note',
      title: '',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      noteBody: { text: 'first line of the note', truncated: true },
    } as never)
    expect(truncated).toContain('Note (truncated): first line of the note')

    const full = render({
      ref: 'zotero://user/0/item/NOTE2222',
      itemType: 'note',
      title: '',
      creators: [],
      abstractTruncated: false,
      tags: [],
      collections: [],
      children: { total: 0 },
      noteBody: { text: 'short note', truncated: false },
    } as never)
    expect(full).toContain('Note: short note')
  })
})
