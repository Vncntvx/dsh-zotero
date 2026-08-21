/**
 * The `children()` provider contract: graph exploration for item refs
 * (notes + attachments + merged cross-attachment annotations) and attachment
 * refs (their own annotations), with identity pinning and fail-closed kind
 * checks.
 * @module tests/provider/children
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_INVALID_REF } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'
import type { ZoteroChildrenRequest } from '../../src/types.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  setupProvider,
  teardownProvider,
  zoteroError,
  type ProviderHarness,
} from '../helpers/provider-harness.js'

let mock: MockZotero
let provider: LocalApiProvider
let harness: ProviderHarness

beforeEach(async () => {
  harness = await setupProvider()
  mock = harness.mock
  provider = harness.provider
})

afterEach(async () => {
  await teardownProvider(harness)
})

const PARENT = {
  key: 'ABCD1234',
  version: 3,
  meta: { numChildren: 2 },
  data: { itemType: 'journalArticle', title: 'FlashAttention-2' },
}

const ATTACHMENT_ROW = {
  key: 'WXYZ6789',
  data: {
    itemType: 'attachment',
    title: 'Full Text PDF',
    contentType: 'application/pdf',
    linkMode: 'imported_file',
  },
}

const CHILDREN_ROWS = [
  { key: 'NOTE1111', data: { itemType: 'note', note: 'my note', parentItem: 'ABCD1234' } },
  ATTACHMENT_ROW,
]

const ANNOTATION_ROWS = [
  {
    key: 'ANNO0002',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'second',
      annotationSortIndex: '00002',
      parentItem: 'WXYZ6789',
    },
  },
  {
    key: 'ANNO0001',
    data: {
      itemType: 'annotation',
      annotationType: 'underline',
      annotationText: 'first',
      annotationSortIndex: '00001',
      annotationPageLabel: '3',
      parentItem: 'WXYZ6789',
    },
  },
]

function routeGraph(serverId?: string): void {
  const headers = serverId === undefined ? {} : { 'Zotero-Server-ID': serverId }
  mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
    helpers.json(PARENT, headers),
  )
  mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
    helpers.json(CHILDREN_ROWS, headers),
  )
  mock.route('GET', '/api/users/0/items/WXYZ6789', (req, res, helpers) =>
    helpers.json(ATTACHMENT_ROW, headers),
  )
  mock.route('GET', '/api/users/0/items/WXYZ6789/children', (req, res, helpers) =>
    helpers.json(ANNOTATION_ROWS, headers),
  )
}

function childrenRequest(
  ref: string,
  include: ('notes' | 'attachments' | 'annotations')[] = ['notes', 'attachments', 'annotations'],
): ZoteroChildrenRequest {
  return { ref: parseRef(ref), include: new Set(include) }
}

describe('children', () => {
  it('returns an item graph: direct notes, attachments, and merged sorted annotations', async () => {
    routeGraph('S1')
    const result = await provider.children(childrenRequest('zotero://user/0/item/ABCD1234'))
    expect(result.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(result.itemType).toBe('journalArticle')
    expect(result.serverId).toBe('S1')
    expect(result.notes).toEqual({
      total: 1,
      returned: 1,
      items: [
        {
          ref: 'zotero://user/0/item/NOTE1111?server=S1',
          text: 'my note',
          truncated: false,
          parentRef: 'zotero://user/0/item/ABCD1234?server=S1',
        },
      ],
    })
    expect(result.attachments?.items[0]).toMatchObject({
      ref: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      title: 'Full Text PDF',
    })
    // Annotations come from the attachment's own children, ordered by
    // Zotero's sort index across the merged corpus.
    expect(result.annotations?.total).toBe(2)
    expect(result.annotations?.items.map((annotation) => annotation.text)).toEqual([
      'first',
      'second',
    ])
    expect(result.annotations?.items[0]!.parentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789?server=S1',
    )
  })

  it('walks the second level only when annotations are requested', async () => {
    routeGraph()
    await provider.children(
      childrenRequest('zotero://user/0/item/ABCD1234', ['notes', 'attachments']),
    )
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
    ])
  })

  it('respects a single-kind include', async () => {
    routeGraph()
    const result = await provider.children(
      childrenRequest('zotero://user/0/item/ABCD1234', ['annotations']),
    )
    expect(result.notes).toBeUndefined()
    expect(result.attachments).toBeUndefined()
    expect(result.annotations?.total).toBe(2)
  })

  it('returns an attachment ref own annotations without a second walk', async () => {
    routeGraph('S1')
    const result = await provider.children(
      childrenRequest('zotero://user/0/attachment/WXYZ6789?server=S1'),
    )
    expect(result.ref).toBe('zotero://user/0/attachment/WXYZ6789?server=S1')
    expect(result.itemType).toBe('attachment')
    expect(result.notes).toBeUndefined()
    expect(result.attachments).toBeUndefined()
    expect(result.annotations?.items.map((annotation) => annotation.text)).toEqual([
      'first',
      'second',
    ])
    const paths = mock.requests.map((entry) => entry.pathname)
    expect(paths).toEqual(['/api/users/0/items/WXYZ6789', '/api/users/0/items/WXYZ6789/children'])
  })

  it('fails closed when an attachment ref names a non-attachment object', async () => {
    routeGraph()
    await zoteroError(
      provider.children(childrenRequest('zotero://user/0/attachment/ABCD1234')),
      ZOTERO_INVALID_ARGUMENT,
      'not an attachment',
    )
  })

  it('rejects annotation refs before any request happens', async () => {
    await zoteroError(
      provider.children(childrenRequest('zotero://user/0/annotation/ANNO1111')),
      ZOTERO_INVALID_REF,
      'Expected a item or attachment reference',
    )
    expect(mock.requests).toEqual([])
  })
})
