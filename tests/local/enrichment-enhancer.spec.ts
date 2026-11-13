/**
 * Cached enrichment in the real local retrieval pipeline. A hit supplies text
 * without claiming Zotero index coverage; a miss keeps the index path and a
 * fault propagates. Ordinary retrieval must never start a document parse.
 * @module tests/local/enrichment-enhancer
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalApiProvider } from '../../src/local/provider.js'
import type { FulltextEnhancer, FulltextLookupResult } from '../../src/local/fulltext-enhancer.js'
import { ZOTERO_NO_FULLTEXT, ZoteroError } from '../../src/errors.js'
import { parseRef } from '../../src/refs.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { testHttpClient } from '../helpers/test-clients.js'
import { PROVIDER_LIMITS, retrieveRequest } from '../helpers/provider-harness.js'
import { requestLines } from '../helpers/server/assert.js'
import { ITEM_KEY, apiPath, attachmentRef } from '../helpers/server/keys.js'
import { attachment } from '../helpers/server/objects.js'
import { serveFulltext, serveItemGraph, type ItemGraphSpec } from '../helpers/server/serve.js'
import {
  FULLTEXT_PAYLOAD,
  RETRIEVE_ATTACHMENT,
  RETRIEVE_ATTACHMENT_CHILDREN,
  RETRIEVE_CHILDREN,
  RETRIEVE_PARENT,
  RETRIEVE_PARENT_WITHOUT_ATTACHMENT_TYPE,
} from './retrieve/support.js'

let mock: MockZotero | undefined

afterEach(async () => {
  await mock?.close()
  mock = undefined
})

function providerOf(server: MockZotero, enhancer?: FulltextEnhancer): LocalApiProvider {
  return new LocalApiProvider({
    client: testHttpClient(server.baseUrl),
    limits: () => PROVIDER_LIMITS,
    fulltextEnhancer: () => enhancer,
  })
}

async function boot(graph: Pick<ItemGraphSpec, 'parent' | 'children'> = {}): Promise<MockZotero> {
  mock = await MockZotero.start()
  serveItemGraph(mock, {
    parent: RETRIEVE_PARENT,
    children: RETRIEVE_CHILDREN,
    annotations: RETRIEVE_ATTACHMENT_CHILDREN,
    attachmentItem: RETRIEVE_ATTACHMENT,
    serverId: null,
    ...graph,
  })
  return mock
}

function enhancerOf(lookup: FulltextEnhancer['lookup']) {
  // Structural typing admits an older upload-capable service. This extra method
  // must remain unreachable until an explicit parse has been authorized.
  return {
    lookup: vi.fn(lookup),
    enhance: vi.fn(async () => {
      throw new Error(
        'ordinary retrieve must not upload a document without explicit parse authorization',
      )
    }),
  }
}

function cached(text: string): Extract<FulltextLookupResult, { kind: 'hit' }> {
  return {
    kind: 'hit',
    text,
    format: 'markdown',
    source: 'MinerU (free)',
    provenance: {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'cached-local-artifact',
      fingerprint: 'a'.repeat(64),
      sourceId: 'b'.repeat(64),
      generation: 'c'.repeat(64),
    },
    pageCount: 1,
  }
}

const policies = ['best', 'specified', 'allIndexed'] as const

function fulltextRequest(attachmentPolicy: (typeof policies)[number]) {
  return retrieveRequest({
    sources: ['fulltext'],
    passages: 2,
    query: 'attention',
    attachmentPolicy,
    ...(attachmentPolicy === 'specified'
      ? { attachmentRefs: [parseRef(attachmentRef(RETRIEVE_ATTACHMENT.key))] }
      : {}),
  })
}

const indexPath = `${apiPath()}/items/${RETRIEVE_ATTACHMENT.key}/fulltext`

describe.each(policies)('cached enrichment under the %s policy', (policy) => {
  it('uses a lookup hit and skips the Zotero index', async () => {
    const server = await boot()
    const text = 'cached attention analysis body'
    const enhancer = enhancerOf(async () => cached(text))
    const result = await providerOf(server, enhancer).retrieve(fulltextRequest(policy))

    expect(result.evidence.map((entry) => entry.text)).toEqual([text])
    expect(result.evidence[0]?.sourceRef).toBe(attachmentRef(RETRIEVE_ATTACHMENT.key))
    expect(result.coverage).toBeUndefined()
    expect(requestLines(server)).not.toContain(indexPath)
    expect(enhancer.lookup).toHaveBeenCalledTimes(1)
    expect(enhancer.lookup.mock.calls[0]?.[0]).toEqual({
      key: attachmentRef(RETRIEVE_ATTACHMENT.key),
      source: { kind: 'local', attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      contentType: 'application/pdf',
    })
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('preserves artifact identity and original Markdown spans in every returned chunk', async () => {
    const server = await boot()
    const text = `\n\n# Attention results\n\n${'attention  **analysis**\n'.repeat(220)}\n\n| attention | estimate |\n| --- | --- |\n| attention | 0.95 |\n`
    const hit = cached(text)
    const enhancer = enhancerOf(async () => hit)
    const result = await providerOf(server, enhancer).retrieve(fulltextRequest(policy))

    expect(result.evidence).toHaveLength(2)
    expect(result).toMatchObject({ textFormat: 'markdown', artifact: hit.provenance })
    for (const entry of result.evidence) {
      expect(entry).toMatchObject({ textFormat: 'markdown', artifact: hit.provenance })
      expect(entry.start).toEqual(expect.any(Number))
      expect(entry.end).toEqual(expect.any(Number))
      expect(text.slice(entry.start, entry.end)).toBe(entry.text)
      expect(entry.text).toContain('attention  **analysis**\n')
      expect(entry.pageLabel).toBeUndefined()
    }
    expect(result.evidence.some((entry) => entry.start! > 0)).toBe(true)
    if (policy !== 'best') {
      expect(result.attachments).toEqual([
        expect.objectContaining({
          ref: attachmentRef(RETRIEVE_ATTACHMENT.key),
          textFormat: 'markdown',
          artifact: hit.provenance,
        }),
      ])
    }
    expect(requestLines(server)).not.toContain(indexPath)
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it.each(['absent', 'expired'] as const)(
    'reads the Zotero index after an %s lookup miss without calling enhance',
    async (reason) => {
      const server = await boot()
      serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
      const enhancer = enhancerOf(async () => ({ kind: 'miss', reason }))
      const result = await providerOf(server, enhancer).retrieve(fulltextRequest(policy))

      expect(result.evidence.map((entry) => entry.text)).toEqual([
        expect.stringContaining('Flash attention speeds up transformer training'),
      ])
      expect(result.coverage).toMatchObject({ indexedPages: 10, totalPages: 12, complete: false })
      expect(result.textFormat).toBe('text')
      expect(result).not.toHaveProperty('artifact')
      if (typeof FULLTEXT_PAYLOAD.content !== 'string') throw new Error('fixture has no index text')
      for (const entry of result.evidence) {
        expect(entry.textFormat).toBe('text')
        expect(entry).not.toHaveProperty('artifact')
        expect(entry.start).toEqual(expect.any(Number))
        expect(entry.end).toEqual(expect.any(Number))
        expect(FULLTEXT_PAYLOAD.content.slice(entry.start, entry.end)).toBe(entry.text)
      }
      for (const facts of result.attachments ?? []) {
        expect(facts.textFormat).toBe('text')
        expect(facts).not.toHaveProperty('artifact')
      }
      expect(requestLines(server).filter((path) => path === indexPath)).toHaveLength(1)
      expect(enhancer.lookup).toHaveBeenCalledTimes(1)
      expect(enhancer.enhance).not.toHaveBeenCalled()
    },
  )

  it.each([
    { name: 'cache validation', error: new Error('cached result invalid') },
    {
      name: 'cache source',
      error: new ZoteroError('cached source unavailable', ZOTERO_NO_FULLTEXT),
    },
    {
      name: 'authorization',
      error: new ZoteroError('token missing', 'ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED'),
    },
  ])('propagates a $name lookup fault instead of reading the index', async ({ error }) => {
    const server = await boot()
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const enhancer = enhancerOf(async () => ({ kind: 'fault', error }))

    await expect(providerOf(server, enhancer).retrieve(fulltextRequest(policy))).rejects.toBe(error)
    expect(requestLines(server)).not.toContain(indexPath)
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('keeps the Zotero text and coverage when no enhancer is installed', async () => {
    const server = await boot()
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const result = await providerOf(server).retrieve(fulltextRequest(policy))

    expect(result.evidence.map((entry) => entry.text)).toEqual([
      expect.stringContaining('Flash attention speeds up transformer training'),
    ])
    expect(result.coverage).toMatchObject({ indexedPages: 10, totalPages: 12, complete: false })
    expect(requestLines(server).filter((path) => path === indexPath)).toHaveLength(1)
  })
})

describe('cached enrichment attachment selection', () => {
  it('looks up an attachment whose best-attachment link has an empty content type', async () => {
    const server = await boot({ parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT_TYPE })
    const text = 'cached empty type attention body'
    const enhancer = enhancerOf(async () => cached(text))
    const result = await providerOf(server, enhancer).retrieve(fulltextRequest('best'))

    expect(enhancer.lookup.mock.calls[0]?.[0]).toEqual({
      key: attachmentRef(RETRIEVE_ATTACHMENT.key),
      source: { kind: 'local', attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      contentType: '',
    })
    expect(result.evidence.map((entry) => entry.text)).toEqual([text])
    expect(requestLines(server)).not.toContain(indexPath)
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('keeps valid short cached text', async () => {
    const server = await boot()
    const enhancer = enhancerOf(async () => cached('short'))
    const result = await providerOf(server, enhancer).retrieve({
      ...fulltextRequest('best'),
      query: 'short',
    })

    expect(result.evidence.map((entry) => entry.text)).toEqual(['short'])
    expect(result.coverage).toBeUndefined()
    expect(requestLines(server)).not.toContain(indexPath)
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('does not attach fulltext artifact or offset facts to annotations, notes, or abstracts', async () => {
    const server = await boot()
    const enhancer = enhancerOf(async () => cached('cached attention evidence'))
    const result = await providerOf(server, enhancer).retrieve({
      ...fulltextRequest('best'),
      sources: ['annotation', 'note', 'abstract', 'fulltext'],
      query: 'attention tiling',
      passages: 8,
    })

    expect(new Set(result.evidence.map((entry) => entry.source))).toEqual(
      new Set(['annotation', 'note', 'abstract', 'fulltext']),
    )
    for (const entry of result.evidence.filter((entry) => entry.source !== 'fulltext')) {
      for (const field of ['textFormat', 'artifact', 'start', 'end']) {
        expect(entry).not.toHaveProperty(field)
      }
    }
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })

  it('combines cached and indexed attachments under allIndexed without parsing the miss', async () => {
    const second = attachment({ key: 'SECD0001', data: { parentItem: ITEM_KEY } })
    const server = await boot({ children: [...RETRIEVE_CHILDREN, second] })
    serveFulltext(server, second.key, FULLTEXT_PAYLOAD)
    const enhancer = enhancerOf(async (input) =>
      input.key === attachmentRef(RETRIEVE_ATTACHMENT.key)
        ? cached('cached attention evidence')
        : { kind: 'miss', reason: 'absent' },
    )
    const result = await providerOf(server, enhancer).retrieve(fulltextRequest('allIndexed'))

    expect(new Set(result.evidence.map((entry) => entry.sourceRef))).toEqual(
      new Set([attachmentRef(RETRIEVE_ATTACHMENT.key), attachmentRef(second.key)]),
    )
    expect(result.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: attachmentRef(RETRIEVE_ATTACHMENT.key),
          status: 'indexed',
          textFormat: 'markdown',
          artifact: cached('').provenance,
        }),
        expect.objectContaining({
          ref: attachmentRef(second.key),
          status: 'indexed',
          textFormat: 'text',
          coverage: expect.objectContaining({ indexedPages: 10, totalPages: 12 }),
        }),
      ]),
    )
    expect(result.attachments).toHaveLength(2)
    expect(
      result.attachments?.find((entry) => entry.ref === attachmentRef(RETRIEVE_ATTACHMENT.key)),
    ).not.toHaveProperty('coverage')
    expect(result).not.toHaveProperty('textFormat')
    expect(result).not.toHaveProperty('artifact')
    const cachedPassage = result.evidence.find(
      (entry) => entry.sourceRef === attachmentRef(RETRIEVE_ATTACHMENT.key),
    )
    expect(cachedPassage).toMatchObject({ textFormat: 'markdown', artifact: cached('').provenance })
    const indexPassage = result.evidence.find(
      (entry) => entry.sourceRef === attachmentRef(second.key),
    )
    expect(indexPassage?.textFormat).toBe('text')
    expect(indexPassage).not.toHaveProperty('artifact')
    expect(
      result.attachments?.find((entry) => entry.ref === attachmentRef(second.key)),
    ).not.toHaveProperty('artifact')
    expect(requestLines(server)).not.toContain(indexPath)
    expect(requestLines(server)).toContain(`${apiPath()}/items/${second.key}/fulltext`)
    expect(enhancer.enhance).not.toHaveBeenCalled()
  })
})
