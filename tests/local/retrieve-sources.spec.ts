/**
 * The `zotero_retrieve` source contract: which sources are fetched and when,
 * how `attachmentPolicy` selects full-text attachments, how a `specified`
 * ref's ownership is proven, and which requested sources are reported as
 * skipped. The ranking itself lives in `retrieve-ranking.spec.ts` and the
 * note-first-class paths in `retrieve-notes.spec.ts`.
 * @module tests/provider/retrieve-sources
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_SERVER_MISMATCH } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import { parseRef } from '../../src/refs.js'
import {
  retrieveRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import {
  expectRequestCount,
  expectRequestLines,
  expectRequestPaths,
  zoteroError,
} from '../helpers/server/assert.js'
import { ITEM_KEY, NOTE_KEY, apiPath, attachmentRef, refOf } from '../helpers/server/keys.js'
import {
  annotationRow,
  attachment,
  item,
  noteRow,
  versionHeaders,
} from '../helpers/server/objects.js'
import { serveFulltext, serveJson, serveItemGraph } from '../helpers/server/serve.js'
import {
  FULLTEXT_PAYLOAD,
  RETRIEVE_ATTACHMENT,
  RETRIEVE_ATTACHMENT_CHILDREN,
  RETRIEVE_CHILDREN,
  RETRIEVE_PARENT,
  RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
} from './retrieve-graph.js'

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

describe('retrieve source selection', () => {
  it('fetches lazily per source: abstract-only evidence needs just the parent', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 1 }))
    expectRequestLines(mock, ['/api/users/0/items/ABCD1234'])
    expect(result.evidence.map((entry) => entry.source)).toEqual(['abstract'])
    expect(result.attachmentRef).toBeUndefined()
  })

  it('gathers note-only evidence without annotation sources', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      annotations: RETRIEVE_ATTACHMENT_CHILDREN,
      serverId: null,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['note'], passages: 2, query: 'tiling' }),
    )
    expectRequestLines(mock, [
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
    ])
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
  })

  it('carries the parent attachment ref on annotation evidence', async () => {
    // Annotations ride ?itemType=annotation — never the bare children listing.
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: [attachment({ data: { parentItem: ITEM_KEY } })],
      annotations: [
        annotationRow({ data: { annotationText: 'parented', parentItem: 'WXYZ6789' } }),
      ],
      serverId: 'S1',
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'parented', passages: 1 }),
    )
    expect(result.evidence).toEqual([
      {
        source: 'annotation',
        sourceRef: 'zotero://user/0/annotation/ANNO1111?server=S1',
        text: 'parented',
        attachmentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      },
    ])
  })

  it('picks a PDF child when the parent has no attachment link', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    serveFulltext(mock, 'WXYZ6789', FULLTEXT_PAYLOAD)
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
  })

  it('omits the attachment content type when Zotero reports none', async () => {
    // The link carries no `attachmentType`; the result must stay silent about
    // a type Zotero never reported.
    const parent = item({
      meta: { numChildren: 3 },
      links: {
        attachment: {
          href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
          type: 'application/json',
        },
      },
    })
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, parent)
    serveFulltext(mock, 'WXYZ6789', FULLTEXT_PAYLOAD)
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(result.attachmentContentType).toBeUndefined()
  })

  it('ranks every PDF child as a first-class source under allIndexed', async () => {
    const secondPdf = attachment({
      key: 'SECD0001',
      data: { title: 'Author Manuscript' },
    })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: [...RETRIEVE_CHILDREN, secondPdf],
      annotations: null,
    })
    serveFulltext(mock, 'WXYZ6789', {
      content: 'publisher copy mentions tiling',
      indexedPages: 10,
      totalPages: 10,
    })
    serveFulltext(mock, 'SECD0001', {
      content: 'manuscript mentions flash attention',
      indexedChars: 30,
      totalChars: 30,
    })
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'tiling flash',
        passages: 10,
        attachmentPolicy: 'allIndexed',
      }),
    )
    // Both files contributed; per-passage provenance maps chunks to files.
    const refs = new Set(result.evidence.map((entry) => entry.sourceRef))
    expect(refs).toEqual(
      new Set([
        'zotero://user/0/attachment/WXYZ6789?server=S1',
        'zotero://user/0/attachment/SECD0001?server=S1',
      ]),
    )
    // With several contributors the result-level attachment stays unset.
    expect(result.attachmentRef).toBeUndefined()
    expect(result.coverage).toBeUndefined()
    expect(result.sourcesSkipped).toEqual([])
  })

  it('degrades allIndexed to sourcesSkipped when no PDF child exists', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [noteRow({ data: { note: 'only a note' } })],
      serverId: null,
    })
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        attachmentPolicy: 'allIndexed',
      }),
    )
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('degrades to sourcesSkipped when no PDF child exists for fulltext', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [noteRow({ data: { note: 'only a note' } })],
      serverId: null,
    })
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'] }))
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('lists every requested-but-missing source in sourcesSkipped', async () => {
    serveItemGraph(mock, {
      parent: item({ meta: { numChildren: 3 }, data: { abstractNote: undefined } }),
      children: [noteRow({ data: { note: 'queries' } })],
      // No annotations under the filtered listing; bare children only has a note.
      annotations: [],
      serverId: null,
    })
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['annotation', 'note', 'abstract', 'fulltext'],
        query: 'queries',
      }),
    )
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
    expect(result.sourcesSkipped).toEqual(['annotation', 'abstract', 'fulltext'])
  })

  it('ranks exactly the named attachments under specified and verifies targets', async () => {
    serveItemGraph(mock, { parent: RETRIEVE_PARENT, attachmentItem: RETRIEVE_ATTACHMENT })
    serveFulltext(mock, 'WXYZ6789', FULLTEXT_PAYLOAD)
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'flash attention',
        passages: 4,
        attachmentPolicy: 'specified',
        attachmentRefs: [parseRef('zotero://user/0/attachment/WXYZ6789?server=S1')],
      }),
    )
    // Exactly one contributor keeps the result-level provenance.
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789?server=S1')
    expect(result.attachmentContentType).toBe('application/pdf')
    expect(result.evidence.length).toBeGreaterThan(0)
  })

  it('reads a repeated specified ref once and ranks its text once', async () => {
    serveItemGraph(mock, { parent: RETRIEVE_PARENT, attachmentItem: RETRIEVE_ATTACHMENT })
    serveFulltext(mock, 'WXYZ6789', FULLTEXT_PAYLOAD)
    const ref = parseRef('zotero://user/0/attachment/WXYZ6789?server=S1')
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'flash attention',
        passages: 4,
        attachmentPolicy: 'specified',
        attachmentRefs: [ref, ref],
      }),
    )
    expect(mock.requests.filter((entry) => entry.pathname.endsWith('/fulltext'))).toHaveLength(1)
    expect(result.evidence).toHaveLength(1)
  })

  it('reports a specified attachment whose row states no content type', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    // A valid attachment row that simply carries no `contentType`; the result
    // must report the omission rather than an empty type.
    serveJson(mock, `${apiPath()}/items/LINK0001`, {
      key: 'LINK0001',
      data: { itemType: 'attachment', parentItem: 'ABCD1234', linkMode: 'linked_url' },
    })
    serveFulltext(mock, 'LINK0001', { content: 'linked page mentions tiling' })
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'tiling',
        attachmentPolicy: 'specified',
        attachmentRefs: [parseRef('zotero://user/0/attachment/LINK0001')],
      }),
    )
    // No content type to state: the field is absent rather than empty.
    expect(result.attachments).toEqual([
      {
        ref: 'zotero://user/0/attachment/LINK0001',
        status: 'indexed',
        inputTruncated: false,
        passages: 1,
        coverage: { complete: false },
      },
    ])
  })

  it('fails closed when a specified ref names a non-attachment', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveJson(mock, `${apiPath()}/items/${NOTE_KEY}`, noteRow())
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef(attachmentRef(NOTE_KEY))],
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'not an attachment',
    )
  })

  it('refuses a specified attachment whose parent is another item', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT, versionHeaders())
    serveJson(
      mock,
      `${apiPath()}/items/OTHER999`,
      attachment({ key: 'OTHER999', data: { parentItem: 'OTHRITEM' } }),
    )
    serveFulltext(mock, 'OTHER999', FULLTEXT_PAYLOAD)
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef('zotero://user/0/attachment/OTHER999?server=S1')],
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'is attached to item OTHRITEM, not to ABCD1234',
    )
    // The stranger's file was never read: its text cannot enter this item's corpus.
    expectRequestPaths(mock, ['/api/users/0/items/ABCD1234', '/api/users/0/items/OTHER999'])
  })

  it('refuses a specified attachment that is top-level or of unproven type', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveJson(
      mock,
      `${apiPath()}/items/TOPLEVEL`,
      attachment({ key: 'TOPLEVEL', data: { title: 'Standalone' } }),
    )
    // Deliberately no `itemType`: naming no type is what makes the row
    // unprovable, not a shape the builders model.
    serveJson(mock, `${apiPath()}/items/UNTYPED1`, {
      key: 'UNTYPED1',
      data: { parentItem: 'ABCD1234' },
    })
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef('zotero://user/0/attachment/TOPLEVEL')],
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'is a top-level attachment with no parent item',
    )
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef('zotero://user/0/attachment/UNTYPED1')],
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'cannot be proven an attachment',
    )
  })

  it('refuses a specified attachment ref stamped with another instance', async () => {
    serveItemGraph(mock, { parent: RETRIEVE_PARENT, attachmentItem: RETRIEVE_ATTACHMENT })
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef('zotero://user/0/attachment/WXYZ6789?server=S9')],
        }),
      ),
      ZOTERO_SERVER_MISMATCH,
      'different Zotero instance',
    )
    // A same-key object of the serving instance is never substituted for it.
    expectRequestPaths(mock, ['/api/users/0/items/ABCD1234'])
  })

  it('refuses a specified attachment from another library', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [parseRef(refOf('attachment', 'WXYZ6789', { type: 'group', id: 7 }))],
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'belongs to library group/7',
    )
    expectRequestPaths(mock, ['/api/users/0/items/ABCD1234'])
  })

  it('refuses a specified list longer than the per-call limit before reading anything', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    const refs = Array.from({ length: 17 }, (_, index) =>
      parseRef(attachmentRef(`A${String(index).padStart(7, '0')}`)),
    )
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: refs,
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'at most 16 can enter one ranking',
    )
    expectRequestPaths(mock, ['/api/users/0/items/ABCD1234'])
  })

  it('fails closed on a specified policy without refs before any request happens', async () => {
    await zoteroError(
      provider.retrieve(
        retrieveRequest({
          sources: ['fulltext'],
          attachmentPolicy: 'specified',
          attachmentRefs: [],
        }),
      ),
      ZOTERO_INVALID_ARGUMENT,
      'requires at least one attachmentRef',
    )
    expectRequestCount(mock, 0)
  })
})
