/**
 * The `zotero_retrieve` provider contract: BM25-ranked evidence across
 * annotations, notes, the abstract, and full-text chunks, with passage and
 * character budgets, honest truncation flags, and per-source degradation.
 * @module tests/provider/retrieve
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZOTERO_UNEXPECTED } from '../../src/errors.js'
import { type LocalApiLimits, type LocalApiProvider } from '../../src/provider-local.js'
import { parseRef } from '../../src/refs.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import {
  createProvider,
  getRequest,
  retrieveRequest,
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

function makeProvider(limits: Partial<LocalApiLimits> = {}): LocalApiProvider {
  return createProvider(mock, limits)
}

const RETRIEVE_PARENT = {
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
  meta: { parsedDate: '2023-07-28', numChildren: 3 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    abstractNote:
      'FlashAttention speeds up transformer training by reordering attention computation.',
    collections: [],
  },
}

const RETRIEVE_CHILDREN = [
  {
    key: 'ANNO1111',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'see the tiling figure for details',
      annotationComment: 'compare with figure 3',
      annotationPageLabel: '7',
      annotationSortIndex: '00001',
    },
  },
  { key: 'NOTE1111', data: { itemType: 'note', note: 'read this for the tiling strategy' } },
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

const FULLTEXT_PAYLOAD = {
  content:
    'Flash attention speeds up transformer training. Attention is all you need. Farming crops in the spring.',
  indexedPages: 10,
  totalPages: 12,
  indexedChars: 1000,
  totalChars: 1200,
}

describe('retrieve', () => {
  it('ranks evidence across sources and reports fulltext coverage', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest())
    // The parent gates everything; children and the linked fulltext then ride
    // the same await and may arrive in either order.
    expect(mock.requests[0]!.pathname).toBe('/api/users/0/items/ABCD1234')
    expect(
      mock.requests
        .slice(1)
        .map((entry) => entry.pathname)
        .sort(),
    ).toEqual(['/api/users/0/items/ABCD1234/children', '/api/users/0/items/WXYZ6789/fulltext'])
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
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    const result = await provider.retrieve(retrieveRequest({ query: 'tiling', passages: 4 }))
    const annotation = result.evidence.find((entry) => entry.source === 'annotation')
    expect(annotation).toBeDefined()
    expect(annotation!.comment).toBe('compare with figure 3')
    expect(annotation!.pageLabel).toBe('7')
  })

  it('carries the parent attachment ref on annotation evidence', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        {
          key: 'ANNO1111',
          data: {
            itemType: 'annotation',
            annotationType: 'highlight',
            annotationText: 'parented',
            parentItem: 'WXYZ6789',
          },
        },
      ]),
    )
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['annotation'], query: 'parented', passages: 1 }),
    )
    expect(result.evidence).toEqual([
      {
        source: 'annotation',
        sourceRef: 'zotero://user/0/item/ANNO1111?server=S1',
        text: 'parented',
        attachmentRef: 'zotero://user/0/attachment/WXYZ6789?server=S1',
      },
    ])
  })

  it('fetches lazily per source: abstract-only evidence needs just the parent', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 1 }))
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
    expect(result.evidence.map((entry) => entry.source)).toEqual(['abstract'])
    expect(result.attachmentRef).toBeUndefined()
  })

  it('picks a PDF child when the parent has no attachment link', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
  })

  it('omits the attachment content type when Zotero reports none', async () => {
    const parent = {
      ...RETRIEVE_PARENT,
      links: {
        self: {
          href: 'http://localhost:23119/api/users/0/items/ABCD1234',
          type: 'application/json',
        },
        attachment: {
          href: 'http://localhost:23119/api/users/0/items/WXYZ6789',
          type: 'application/json',
        },
      },
    }
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) => helpers.json(parent))
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.attachmentRef).toBe('zotero://user/0/attachment/WXYZ6789')
    expect(result.attachmentContentType).toBeUndefined()
  })

  it('degrades an unindexed fulltext response to sourcesSkipped', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'No indexed full text'),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'] }))
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
    expect(result.truncated).toBe(false)
  })

  it('caps evidence by passage count and reports truncation', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest({ passages: 1 }))
    expect(result.evidence).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('caps evidence by the character budget', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 20 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await narrow.retrieve(retrieveRequest())
    expect(result.evidence.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(
      20,
    )
    expect(result.truncated).toBe(true)
  })

  it('bounds fulltext by the configured character budget and reports the cut', async () => {
    const narrow = makeProvider({ maxFulltextChars: 40 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await narrow.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 4 }))
    // The truncated flag is the honest signal that full text was cut before
    // ranking; every passage stays a verbatim span of the bounded prefix.
    expect(result.truncated).toBe(true)
    const prefix = FULLTEXT_PAYLOAD.content.slice(0, 40)
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
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({ content: 'a'.repeat(10) }),
    )
    const result = await narrow.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 4, query: 'aaaaaaaaaa' }),
    )
    // A passage whose length lands exactly on the budget is accepted: an
    // off-by-one (>=) would drop it and silently return less evidence.
    expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0]!.text).toBe('a'.repeat(10))
    expect(result.truncated).toBe(false)
  })

  it('chunks fulltext at the configured passage word count', async () => {
    const narrow = makeProvider({ fulltextChunkWords: 2 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await narrow.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 20 }))
    // Evidence comes back BM25-ranked, so chunk order is relevance order, not
    // source order; each chunk is still a verbatim span of the original text.
    const chunks = result.evidence.filter((entry) => entry.source === 'fulltext')
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.text.split(/\s+/).filter((part) => part !== '').length).toBeLessThanOrEqual(2)
      expect(FULLTEXT_PAYLOAD.content).toContain(chunk.text)
    }
  })

  it('rejects non-item refs before any request happens', async () => {
    await zoteroError(
      provider.retrieve(retrieveRequest({ ref: parseRef('zotero://user/0/attachment/WXYZ6789') })),
      'ZOTERO_INVALID_REF',
      'Expected a item reference',
    )
    expect(mock.requests).toEqual([])
  })
})

describe('retrieve edge cases', () => {
  it('gathers note-only evidence without annotation sources', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['note'], passages: 2, query: 'tiling' }),
    )
    expect(mock.requests.map((entry) => entry.pathname)).toEqual([
      '/api/users/0/items/ABCD1234',
      '/api/users/0/items/ABCD1234/children',
    ])
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
  })

  it('degrades to sourcesSkipped when no PDF child exists for fulltext', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'only a note' } }]),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'] }))
    expect(result.evidence).toEqual([])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('passes non-404 fulltext failures through unchanged', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom'),
    )
    await zoteroError(
      provider.retrieve(retrieveRequest({ sources: ['fulltext'] })),
      ZOTERO_UNEXPECTED,
      'HTTP 500',
    )
  })
})

describe('retrieve tolerances', () => {
  it('reports page-only coverage when the payload lacks char counts', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({
        content: 'flash attention everywhere',
        indexedPages: 2,
        totalPages: 5,
      }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 1 }))
    expect(result.coverage).toEqual({ indexedPages: 2, totalPages: 5, complete: false })
  })

  it('treats a non-array children response as no annotation or note evidence', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json({ key: 'NOTE1111' }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['note'], passages: 2 }))
    expect(result.evidence).toEqual([])
    expect(result.truncated).toBe(false)
    // A requested source the item cannot provide is reported, not silently
    // absent: the malformed children response yields no notes.
    expect(result.sourcesSkipped).toEqual(['note'])
  })

  it('omits abstract evidence when the parent has no abstract', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        ...RETRIEVE_PARENT,
        data: { ...RETRIEVE_PARENT.data, abstractNote: undefined },
      }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 2 }))
    expect(result.evidence).toEqual([])
  })

  it('omits abstract evidence when the abstract is empty', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, data: { ...RETRIEVE_PARENT.data, abstractNote: '' } }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['abstract'], passages: 2 }))
    expect(result.evidence).toEqual([])
  })

  it('treats a stringless fulltext content as no chunks', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({ content: 42 }),
    )
    const result = await provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 2 }))
    expect(result.evidence).toEqual([])
    expect(result.coverage).toEqual({ complete: false })
  })
})

describe('note-first-class paths', () => {
  it('treats a note item own body as its note source without fetching children', async () => {
    mock.route('GET', '/api/users/0/items/NOTE9999', (req, res, helpers) =>
      helpers.json({
        key: 'NOTE9999',
        data: {
          itemType: 'note',
          note: '<p>cascade failure chains</p><p>infrastructure interdependency</p>',
        },
      }),
    )
    const result = await provider.retrieve(
      retrieveRequest({
        ref: parseRef('zotero://user/0/item/NOTE9999'),
        query: 'cascade',
        sources: ['note'],
        passages: 4,
      }),
    )
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/NOTE9999'])
    expect(result.evidence).toEqual([
      {
        source: 'note',
        sourceRef: 'zotero://user/0/item/NOTE9999',
        text: 'cascade failure chains\ninfrastructure interdependency',
        chunkIndex: 0,
        chunkCount: 1,
      },
    ])
    expect(result.sourcesSkipped).toEqual([])
  })

  it('recognizes a note item from the top-level itemType fallback', async () => {
    mock.route('GET', '/api/users/0/items/NOTE9999', (req, res, helpers) =>
      helpers.json({ key: 'NOTE9999', itemType: 'note', data: { note: 'own body words' } }),
    )
    const result = await provider.retrieve(
      retrieveRequest({
        ref: parseRef('zotero://user/0/item/NOTE9999'),
        query: 'body',
        sources: ['note'],
        passages: 2,
      }),
    )
    expect(result.evidence.map((entry) => entry.text)).toEqual(['own body words'])
  })

  it('contributes every chunk of a long child note with locators', async () => {
    const narrow = makeProvider({ fulltextChunkWords: 2 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        { key: 'NOTE1111', data: { itemType: 'note', note: 'alpha beta gamma delta epsilon' } },
      ]),
    )
    const result = await narrow.retrieve(
      retrieveRequest({ sources: ['note'], passages: 10, query: 'alpha gamma epsilon' }),
    )
    // BM25 ranks the shorter `epsilon` chunk above the tied longer ones, so
    // the order is relevance order, not source order — every chunk must still
    // be present with its locators.
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note', 'note', 'note'])
    expect(result.evidence.map((entry) => entry.text).sort()).toEqual([
      'alpha beta',
      'epsilon',
      'gamma delta',
    ])
    expect(new Set(result.evidence.map((entry) => entry.chunkIndex))).toEqual(new Set([0, 1, 2]))
    expect(result.evidence.map((entry) => entry.chunkCount)).toEqual([3, 3, 3])
    expect(
      result.evidence.every((entry) => entry.sourceRef === 'zotero://user/0/item/NOTE1111'),
    ).toBe(true)
  })

  it('skips an unavailable fulltext source while keeping note evidence', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({ ...RETRIEVE_PARENT, links: { self: RETRIEVE_PARENT.links.self } }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'tiling strategy note' } }]),
    )
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['note', 'fulltext'], query: 'tiling' }),
    )
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
    expect(result.sourcesSkipped).toEqual(['fulltext'])
  })

  it('returns the note body for note items under the configured budget', async () => {
    const narrow = makeProvider({ maxNoteBodyChars: 8 })
    mock.route('GET', '/api/users/0/items/NOTE9999', (req, res, helpers) =>
      helpers.json({
        key: 'NOTE9999',
        data: { itemType: 'note', note: '<p>first line</p><p>second line long</p>' },
      }),
    )
    const detail = await narrow.getItem({
      ref: parseRef('zotero://user/0/item/NOTE9999'),
      include: new Set(),
    })
    expect(detail.itemType).toBe('note')
    expect(detail.noteBody).toEqual({ text: 'first li', truncated: true })
  })

  it('carries the parent ref on child note records', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([
        {
          key: 'NOTE1111',
          data: { itemType: 'note', note: 'child note', parentItem: 'ABCD1234' },
        },
      ]),
    )
    const detail = await provider.getItem(getRequest(['notes']))
    expect(detail.notes!.items[0]).toMatchObject({
      ref: 'zotero://user/0/item/NOTE1111?server=S1',
      parentRef: 'zotero://user/0/item/ABCD1234?server=S1',
    })
  })
})

describe('retrieval contract hardening', () => {
  it('reports a complete PDF index from the pages axis alone', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({ content: 'flash attention', indexedPages: 5, totalPages: 5 }),
    )
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], query: 'flash' }),
    )
    expect(result.coverage).toEqual({ indexedPages: 5, totalPages: 5, complete: true })
  })

  it('reports a complete text-file index from the chars axis alone', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({ content: 'flash attention', indexedChars: 15, totalChars: 15 }),
    )
    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], query: 'flash' }),
    )
    expect(result.coverage).toEqual({ indexedChars: 15, totalChars: 15, complete: true })
  })

  it('reports incomplete coverage when two reportable axes disagree', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({
        content: 'flash attention',
        indexedPages: 5,
        totalPages: 5,
        indexedChars: 10,
        totalChars: 15,
      }),
    )
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

  it('returns no evidence when no passage shares a token with the query', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json(RETRIEVE_CHILDREN),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json(FULLTEXT_PAYLOAD),
    )
    const result = await provider.retrieve(retrieveRequest({ query: 'quantum entanglement' }))
    expect(result.evidence).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('lists every requested-but-missing source in sourcesSkipped', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json({
        ...RETRIEVE_PARENT,
        links: { self: RETRIEVE_PARENT.links.self },
        data: { ...RETRIEVE_PARENT.data, abstractNote: undefined },
      }),
    )
    mock.route('GET', '/api/users/0/items/ABCD1234/children', (req, res, helpers) =>
      helpers.json([{ key: 'NOTE1111', data: { itemType: 'note', note: 'queries' } }]),
    )
    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['annotation', 'note', 'abstract', 'fulltext'],
        query: 'queries',
      }),
    )
    expect(result.evidence.map((entry) => entry.source)).toEqual(['note'])
    expect(result.sourcesSkipped).toEqual(['annotation', 'abstract', 'fulltext'])
  })

  it('keeps unspaced CJK full text digestible: every chunk fits the evidence budget', async () => {
    const narrow = makeProvider({ maxEvidenceChars: 200 })
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT),
    )
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({ content: '中文全文没有空格'.repeat(60) }),
    )
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
})
