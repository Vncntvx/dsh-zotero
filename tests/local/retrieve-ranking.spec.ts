/**
 * The `zotero_retrieve` ranking contract: BM25 ordering across annotation,
 * note, abstract, and full-text passages, which fields an annotation matched,
 * and the passage/character budgets that bound the evidence with the
 * `truncated` flag. Which sources are read at all lives in
 * `retrieve-sources.spec.ts`.
 * @module tests/provider/retrieve-ranking
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LocalApiProvider } from '../../src/local/provider.js'
import type { LocalApiLimits } from '../../src/local/limits.js'
import {
  createProvider,
  retrieveRequest,
  setupProvider,
  teardownProvider,
  type ProviderHarness,
} from '../helpers/provider-harness.js'
import { requestLines } from '../helpers/server/assert.js'
import { ATTACHMENT_KEY, ITEM_KEY, apiPath } from '../helpers/server/keys.js'
import { annotationRow, attachment } from '../helpers/server/objects.js'
import { serveFulltext, serveJson, serveItemGraph } from '../helpers/server/serve.js'
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

/** The canonical graph: parent, its note and PDF children, the PDF's annotations, and the fulltext. */
function routeGraph(): void {
  serveItemGraph(mock, {
    parent: RETRIEVE_PARENT,
    children: RETRIEVE_CHILDREN,
    annotations: RETRIEVE_ATTACHMENT_CHILDREN,
    serverId: null,
  })
  serveFulltext(mock, ATTACHMENT_KEY, FULLTEXT_PAYLOAD)
}

describe('retrieve ranking', () => {
  it('ranks evidence across sources and reports fulltext coverage', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      annotations: RETRIEVE_ATTACHMENT_CHILDREN,
    })
    serveFulltext(mock, ATTACHMENT_KEY, FULLTEXT_PAYLOAD)
    const result = await provider.retrieve(retrieveRequest())
    // The parent gates everything; the two children contracts and the linked
    // fulltext then ride the same await and may arrive in either order.
    const lines = requestLines(mock)
    expect(lines[0]).toBe('/api/users/0/items/ABCD1234')
    expect(lines.slice(1).sort()).toEqual([
      '/api/users/0/items/ABCD1234/children',
      '/api/users/0/items/ABCD1234/children?itemType=annotation',
      '/api/users/0/items/WXYZ6789/fulltext',
    ])
    expect(result.ref).toBe('zotero://user/0/item/ABCD1234?server=S1')
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789?server=S1')
    expect(result.attachmentContentType).toBe('application/pdf')
    expect(result.coverage).toEqual({
      indexedPages: 10,
      totalPages: 12,
      indexedChars: 1000,
      totalChars: 1200,
      complete: false,
    })
    expect(result.truncated).toBe(false)
    const sources = result.evidence.map((entry) => entry.source)
    // The full ranked order is contract: the fulltext chunk carries every
    // query term (flash tf 1, attention tf 2) and the abstract only
    // `attention`. The annotation and the note share no query term, so their
    // zero scores drop out instead of masquerading as ranked evidence.
    expect(sources).toEqual(['fulltext', 'abstract'])
    expect(result.evidence[0]!.text).toContain('Flash attention')
  })

  it('carries annotation comments and page labels on ranked evidence', async () => {
    routeGraph()
    const result = await provider.retrieve(retrieveRequest({ query: 'tiling', passages: 4 }))
    const annotation = result.evidence.find((entry) => entry.source === 'annotation')
    expect(annotation).toBeDefined()
    expect(annotation!.comment).toBe('compare with figure 3')
    expect(annotation!.pageLabel).toBe('7')
    // The quote carries the term, so it is the field named.
    expect(annotation!.matchedFields).toEqual(['text'])
  })

  it('ranks an annotation on its reader comment and names the comment as the match', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: [attachment()],
      annotations: [
        annotationRow({
          key: 'ANNO2222',
          data: {
            annotationType: 'note',
            annotationText: '',
            annotationComment: 'the sampling method looks biased to me',
            parentItem: ATTACHMENT_KEY,
          },
        }),
      ],
      serverId: null,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'sampling biased', passages: 4 }),
    )
    // A comment-only annotation used to be unreachable: the quote is empty and
    // the comment never entered the ranking.
    expect(result.evidence).toHaveLength(1)
    const annotation = result.evidence[0]!
    expect(annotation.text).toBe('')
    expect(annotation.comment).toBe('the sampling method looks biased to me')
    expect(annotation.matchedFields).toEqual(['comment'])
  })

  it('names both fields when the quote and the comment carry the terms', async () => {
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: [attachment()],
      annotations: [
        annotationRow({
          key: 'ANNO3333',
          data: {
            annotationText: 'the sampling strategy',
            annotationComment: 'sampling here is biased',
            parentItem: ATTACHMENT_KEY,
          },
        }),
      ],
      serverId: null,
    })
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'sampling', passages: 4 }),
    )
    expect(result.evidence[0]!.matchedFields).toEqual(['text', 'comment'])
  })

  it('leaves matchedFields off single-field sources', async () => {
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['abstract'], query: 'reordering', passages: 1 }),
    )
    expect(result.evidence[0]!.matchedFields).toBeUndefined()
  })

  it('caps evidence by passage count and reports truncation', async () => {
    routeGraph()
    const result = await provider.retrieve(retrieveRequest({ passages: 1 }))
    expect(result.evidence).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('caps evidence by the character budget', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 20 })
    routeGraph()
    const result = await narrow.retrieve(retrieveRequest())
    expect(result.evidence.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      20,
    )
    expect(result.truncated).toBe(true)
  })

  it('bounds fulltext by the configured character budget and reports the cut', async () => {
    const narrow = makeProvider({ maxFulltextChars: 40 })
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, FULLTEXT_PAYLOAD)
    const result = await narrow.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 4 }))
    // The truncated flag is the honest signal that full text was cut before
    // ranking; every passage stays a verbatim span of the bounded prefix.
    expect(result.truncated).toBe(true)
    const prefix = String(FULLTEXT_PAYLOAD.content).slice(0, 40)
    expect(result.evidence.length).toBeGreaterThan(0)
    for (const entry of result.evidence) {
      expect(prefix).toContain(entry.text)
    }
    expect(result.evidence.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      40,
    )
  })

  it('fills the character budget exactly when the top passage lands on the boundary', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 10 })
    serveJson(mock, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    serveFulltext(mock, ATTACHMENT_KEY, { content: 'a'.repeat(10) })
    const result = await narrow.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 4, query: 'aaaaaaaaaa' }),
    )
    // A passage whose length lands exactly on the budget is accepted: an
    // off-by-one (>=) would drop it and silently return less evidence.
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]!.text).toBe('a'.repeat(10))
    expect(result.truncated).toBe(false)
  })

  it('charges an annotation comment to the same character budget as its text', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 20 })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT,
      children: [attachment()],
      annotations: [
        annotationRow({
          key: 'ANNO4444',
          data: {
            annotationText: 'tiling',
            // 12 characters of text plus this comment exceed the 20-character
            // budget; charging only the text would have let the comment in.
            annotationComment: 'a comment far longer than the budget allows',
            parentItem: ATTACHMENT_KEY,
          },
        }),
      ],
      serverId: null,
    })
    const result = await narrow.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'tiling', passages: 4 }),
    )
    expect(result.evidence).toEqual([])
    // The omission is stated, not hidden: the passage matched and was dropped
    // by the budget.
    expect(result.truncated).toBe(true)

    // A comment that fits is returned whole and counted.
    const roomy = makeProvider({ maxEvidenceChars: 200 })
    const fitting = await roomy.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'tiling', passages: 4 }),
    )
    expect(fitting.evidence).toHaveLength(1)
    expect(fitting.evidence[0]!.comment).toBe('a comment far longer than the budget allows')
    expect(fitting.truncated).toBe(false)
  })

  it('chunks fulltext at the configured passage word count', async () => {
    const narrow = makeProvider({ fulltextChunkWords: 2 })
    routeGraph()
    const result = await narrow.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 20 }))
    // Evidence comes back BM25-ranked, so chunk order is relevance order, not
    // source order; each chunk is still a verbatim span of the original text.
    const chunks = result.evidence.filter((entry) => entry.source === 'fulltext')
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.split(/\s+/).filter((part) => part !== '').length).toBeLessThanOrEqual(2)
      expect(String(FULLTEXT_PAYLOAD.content)).toContain(chunk.text)
    }
  })

  it('splits the call character budget across the attachments it reads', async () => {
    const long = 'tiling '.repeat(400)
    const secondPdf = attachment({
      key: 'SECD0001',
      data: { title: 'Author Manuscript' },
    })
    serveItemGraph(mock, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT,
      children: [...RETRIEVE_CHILDREN, secondPdf],
      annotations: null,
      serverId: null,
    })
    serveJson(mock, /^\/api\/users\/0\/items\/(SECD0001|WXYZ6789)\/fulltext$/, {
      content: long,
      indexedChars: 10,
      totalChars: 10,
    })
    const capped = makeProvider({ maxFulltextChars: 100 })
    const result = await capped.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        query: 'tiling',
        passages: 4,
        attachmentPolicy: 'allIndexed',
      }),
    )
    // Two sources, 100 characters to share: each file is cut to 50, and the
    // call says so per file and in its own truncated flag.
    expect(result.attachments?.map((entry) => entry.inputTruncated)).toEqual([true, true])
    expect(result.attachments?.every((entry) => (entry.passages ?? 0) > 0)).toBe(true)
    expect(result.evidence.every((entry) => entry.text.length <= 50)).toBe(true)
    expect(result.truncated).toBe(true)
  })
})
