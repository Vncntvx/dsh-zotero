/**
 * The `children()` provider contract: child-object exploration for item refs
 * (direct notes/attachments + annotations via the filtered listing) and
 * attachment refs (their own annotations), with identity pinning and
 * fail-closed kind checks.
 * @module tests/provider/children
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_INVALID_REF } from '../../src/errors.js'
import { attachmentTargetKindMessage } from '../../src/local/detail.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { expectedKindRefMessage, parseRef } from '../../src/refs.js'
import type { ZoteroChildrenRequest } from '../../src/types.js'
import {
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import {
  expectRequestCount,
  expectRequestLines,
  expectRequestLinesAnyOrder,
  zoteroError,
} from '../helpers/server/assert.js'
import { ATTACHMENT_KEY, ITEM_KEY, attachmentRef, itemRef } from '../helpers/server/keys.js'
import { annotationRow, attachment, item, noteRow } from '../helpers/server/objects.js'
import { serveItemGraph } from '../helpers/server/serve.js'

let mock: ProviderHarness['mock']
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

/** The paper as this walk reads it: identity and a child count, nothing else. */
const PARENT = item({ meta: { numChildren: 2 } })

/** The parent's direct children: one note and the PDF. Never annotations. */
const CHILDREN_ROWS = [noteRow({ data: { parentItem: ITEM_KEY } }), attachment()]

/**
 * Two annotations under the PDF, declared out of order on purpose: the merged
 * corpus must return them by Zotero's sort index, not by arrival.
 */
const ANNOTATION_ROWS = [
  annotationRow({
    key: 'ANNO0002',
    data: { annotationType: 'highlight', annotationText: 'second', annotationSortIndex: '00002' },
  }),
  annotationRow({
    key: 'ANNO0001',
    data: {
      annotationType: 'underline',
      annotationText: 'first',
      annotationSortIndex: '00001',
      annotationPageLabel: '3',
    },
  }),
]

/**
 * Serve the graph under the real Local API partition. `serverId` is omitted
 * by the specs that only assert paths, which is also how a build that
 * reports no instance answers.
 */
function routeGraph(serverId?: string): void {
  serveItemGraph(mock, {
    parent: PARENT,
    children: CHILDREN_ROWS,
    annotations: ANNOTATION_ROWS,
    serverId: serverId ?? null,
  })
}

function childrenRequest(
  ref: string,
  include: ('notes' | 'attachments' | 'annotations')[] = ['notes', 'attachments', 'annotations'],
): ZoteroChildrenRequest {
  return { ref: parseRef(ref), include: new Set(include) }
}

describe('children', () => {
  it('returns an item graph: direct notes, attachments, and filtered annotations', async () => {
    routeGraph('S1')
    const result = await provider.children(childrenRequest(itemRef()))
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
    // Annotations come from ?itemType=annotation, ordered by sort index.
    expect(result.annotations?.total).toBe(2)
    expect(result.annotations?.items.map((annotation) => annotation.text)).toEqual([
      'first',
      'second',
    ])
    expect(result.annotations?.items[0]!.parentRef).toBe(
      'zotero://user/0/attachment/WXYZ6789?server=S1',
    )
  })

  it('reads only the bare children listing when annotations are not requested', async () => {
    routeGraph()
    await provider.children(childrenRequest(itemRef(), ['notes', 'attachments']))
    expectRequestLines(mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
    ])
  })

  it('reads only the filtered annotation listing for an annotations-only item ref', async () => {
    routeGraph()
    const result = await provider.children(childrenRequest(itemRef(), ['annotations']))
    expect(result.notes).toBeUndefined()
    expect(result.attachments).toBeUndefined()
    expect(result.annotations?.total).toBe(2)
    expectRequestLines(mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children?itemType=annotation',
    ])
  })

  it('fans out the two contracts in parallel when both halves are requested', async () => {
    routeGraph()
    await provider.children(childrenRequest(itemRef(), ['notes', 'annotations']))
    expectRequestLinesAnyOrder(mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/ABCD1234/children?itemType=annotation',
    ])
  })

  it('returns an attachment ref own annotations via the filtered listing only', async () => {
    routeGraph('S1')
    const result = await provider.children(childrenRequest(attachmentRef()))
    expect(result.ref).toBe('zotero://user/0/attachment/WXYZ6789?server=S1')
    expect(result.itemType).toBe('attachment')
    expect(result.notes).toBeUndefined()
    expect(result.attachments).toBeUndefined()
    expect(result.annotations?.items.map((annotation) => annotation.text)).toEqual([
      'first',
      'second',
    ])
    expectRequestLines(mock, [
      `/api/users/0/items/${ATTACHMENT_KEY}`,
      `/api/users/0/items/${ATTACHMENT_KEY}/children?itemType=annotation`,
    ])
  })

  it('issues no children request for an attachment ref that omits annotations', async () => {
    routeGraph()
    const result = await provider.children(childrenRequest(attachmentRef(), ['notes']))
    expect(result.annotations).toBeUndefined()
    expectRequestLines(mock, [`/api/users/0/items/${ATTACHMENT_KEY}`])
  })

  it('fails closed when an attachment ref names a non-attachment object', async () => {
    routeGraph()
    await zoteroError(
      provider.children(childrenRequest('zotero://user/0/attachment/ABCD1234')),
      ZOTERO_INVALID_ARGUMENT,
      attachmentTargetKindMessage('journalArticle'),
    )
  })

  it('rejects annotation refs before any request happens', async () => {
    await zoteroError(
      provider.children(childrenRequest('zotero://user/0/annotation/ANNO1111')),
      ZOTERO_INVALID_REF,
      expectedKindRefMessage(['item', 'attachment'], 'annotation'),
    )
    expectRequestCount(mock, 0)
  })
})
