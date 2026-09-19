/**
 * The `zotero_retrieve` tolerance contract: degradation for unindexed or
 * unread attachments, coverage across the page and character axes, malformed
 * payloads, queries that match nothing, unspaced CJK text, and abort
 * propagation. Happy-path ranking lives in `retrieve-ranking.spec.ts`.
 * @module tests/provider/retrieve-tolerance
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import { expectedKindRefMessage, parseRef } from '../../src/refs.js'
import {
  createProvider,
  retrieveRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { expectRequestCount, zoteroError } from '../helpers/server/assert.js'
import {
  ATTACHMENT_KEY,
  ITEM_KEY,
  NOTE_KEY,
  apiPath,
  attachmentRef,
} from '../helpers/server/keys.js'
import { attachment, noteRow, paperItem } from '../helpers/server/objects.js'
import { serveFulltext, serveJson, serveItemGraph, serveStatus } from '../helpers/server/serve.js'
import {
  FULLTEXT_PAYLOAD,
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

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
}

describe('retrieve tolerances', () => {
  it('reports page-only coverage when the payload lacks char counts', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, {
      content: 'flash attention everywhere',
      indexedPages: 2,
      totalPages: 5,
    })
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.coverage).toEqual({ indexedPages: 2, totalPages: 5, complete: false })
  })

  it('reports a complete PDF index from the pages axis alone', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, {
      content: 'flash attention',
      indexedPages: 5,
      totalPages: 5,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], query: 'flash' }),
    )
    expect(result.coverage).toEqual({ indexedPages: 5, totalPages: 5, complete: true })
  })

  it('reports a complete text-file index from the chars axis alone', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, {
      content: 'flash attention',
      indexedChars: 15,
      totalChars: 15,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], query: 'flash' }),
    )
    expect(result.coverage).toEqual({ indexedChars: 15, totalChars: 15, complete: true })
  })

  it('reports incomplete coverage when two reportable axes disagree', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, {
      content: 'flash attention',
      indexedPages: 5,
      totalPages: 5,
      indexedChars: 10,
      totalChars: 15,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], query: 'flash' }),
    )
    expect(result.coverage).toEqual({
      indexedPages: 5,
      totalPages: 5,
      indexedChars: 10,
      totalChars: 15,
      complete: false,
    })
  })

  it('treats a non-array children response as no annotation or note evidence', async () => {
    serveItemGraph(mock, { parent: RETRIEVE_PARENT, children: null, serverId: null })
    // A non-array body is not a child listing any builder models.
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}/children`, { key: NOTE_KEY })
    const result = await provider.retrieve(retrieveRequest({ sources: ['note'], passages: 2 }))
    expect(result.evidence).toEqual([])
    expect(result.truncated).toBe(false)
    // A requested source the item cannot provide is reported, not silently
    // absent: the malformed children response yields no notes.
    expect(result.sourcesSkipped).toEqual(['note'])
  })

  it('omits abstract evidence when the parent has no abstract', async () => {
    serveJson(
      mock,
      `${apiPath()}/items/${ITEM_KEY}`,
      paperItem({ data: { abstractNote: undefined } }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 2 }))
    expect(result.evidence).toEqual([])
  })

  it('omits abstract evidence when the abstract is empty', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, paperItem({ data: { abstractNote: '' } }))
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 2 }))
    expect(result.evidence).toEqual([])
  })

  it('treats a stringless fulltext content as no chunks', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, { content: 42 })
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 2 }))
    expect(result.evidence).toEqual([])
    expect(result.coverage).toEqual({ complete: false })
  })

  it('degrades an unindexed fulltext response to sourcesSkipped', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveStatus(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/fulltext`, 404, 'No indexed full text')
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'] }))
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
    expect(result.truncated).toBe(false)
  })

  it('keeps indexed members of an allIndexed set while unindexed ones degrade alone', async () => {
    const secondPdf = attachment({
      key: 'SECD0001',
      data: { title: 'Supplement' },
    })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [...RETRIEVE_CHILDREN, secondPdf],
      serverId: null,
    })
    serveStatus(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/fulltext`, 404, 'No indexed content')
    serveFulltext(mock, 'SECD0001', { content: 'supplement mentions tiling' })
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'tiling',
        passages: 4,
        attachmentPolicy: 'allIndexed',
      }),
    )
    expect(result.evidence.map((entry) => entry.sourceRef)).toEqual([
      'zotero://user/0/attachment/SECD0001',
    ])
    // One contributor survived, so the set did not count as a skipped source.
    expect(result.sourcesSkipped).toEqual([])
    // Every member is reported on, so an unindexed supplement reads as a gap
    // rather than as a file with nothing to say. Selection order is the
    // deterministic PDF ranking, so SECD0001 leads.
    expect(result.attachments).toEqual([
      {
        ref: 'zotero://user/0/attachment/SECD0001',
        contentType: 'application/pdf',
        status: 'indexed',
        coverage: { complete: false },
        inputTruncated: false,
        passages: 1,
      },
      {
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
        status: 'unindexed',
      },
    ])
  })

  it('reports allIndexed as skipped when every PDF is unindexed', async () => {
    const secondPdf = attachment({ key: 'SECD0001', data: { title: 'S' } })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [secondPdf],
      serverId: null,
    })
    serveStatus(
      mock,
      /^\/api\/users\/0\/items\/(SECD0001|WXYZ6789)\/fulltext$/,
      404,
      'No indexed content',
    )
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], attachmentPolicy: 'allIndexed' }),
    )
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('reports attachments beyond the per-call limit as unread', async () => {
    const many = Array.from({ length: 17 }, (_, index) =>
      attachment({
        key: `PDF${String(index).padStart(5, '0')}`,
        data: { title: `File ${index}`, parentItem: ITEM_KEY },
      }),
    )
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: many,
      serverId: null,
    })
    serveJson(mock, /^\/api\/users\/0\/items\/PDF\d{5}\/fulltext$/, {
      content: 'tiling strategies',
    })
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'tiling',
        passages: 4,
        attachmentPolicy: 'allIndexed',
      }),
    )
    expect(result.attachments).toHaveLength(17)
    expect(result.attachments?.filter((entry) => entry.status === 'indexed')).toHaveLength(16)
    expect(result.attachments?.filter((entry) => entry.status === 'unread')).toHaveLength(1)
    // The 17th file was never fetched: the cap bounds the call's work.
    expect(mock.requests.filter((entry) => entry.pathname.endsWith('/fulltext'))).toHaveLength(16)
  })

  it('propagates non-indexing failures from the multi-attachment fetch', async () => {
    const secondPdf = attachment({ key: 'SECD0001', data: { title: 'S' } })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [secondPdf],
      serverId: null,
    })
    serveStatus(mock, `${apiPath()}/items/SECD0001/fulltext`, 500, 'boom')
    await zoteroError(
      provider.retrieve(retrieveRequest({ sources: ['fulltext'], attachmentPolicy: 'allIndexed' })),
      ZOTERO_UNEXPECTED,
      'HTTP 500',
    )
  })

  it('passes non-404 fulltext failures through unchanged', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveStatus(mock, `${apiPath()}/items/${ATTACHMENT_KEY}/fulltext`, 500, 'boom')
    await zoteroError(
      provider.retrieve(retrieveRequest({ sources: ['fulltext'] })),
      ZOTERO_UNEXPECTED,
      'HTTP 500',
    )
  })

  it('returns no evidence when no passage shares a token with the query', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      annotations: RETRIEVE_ATTACHMENT_CHILDREN,
      serverId: null,
    })
    serveFulltext(mock, ATTACHMENT_KEY, FULLTEXT_PAYLOAD)
    const result = await provider.retrieve(retrieveRequest({ query: 'quantum entanglement' }))
    expect(result.evidence).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('keeps unspaced CJK full text digestible: every chunk fits the evidence budget', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 200 })
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, { content: '中文全文没有空格'.repeat(60) })
    const result = await narrow.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 2, query: '中文' }),
    )
    expect(result.evidence.length).toBeGreaterThan(0)
    for (const entry of result.evidence) {
      expect(entry.text.length).toBeLessThanOrEqual(200)
    }
  })

  it('propagates an explicit abort from the status probe', async () => {
    mock.route('GET', '/api/', (req, res, helpers) => helpers.delayJson({}, 5000))
    const controller = new AbortController()
    const probe = provider.status(controller.signal)
    controller.abort()
    await expect(probe).rejects.toThrow()
  })

  it('rejects non-item refs before any request happens', async () => {
    await zoteroError(
      provider.retrieve(retrieveRequest({ ref: parseRef(attachmentRef()) })),
      'ZOTERO_INVALID_REF',
      expectedKindRefMessage(['item'], 'attachment'),
    )
    expectRequestCount(mock, 0)
  })
})
