/**
 * `mode:"fulltext"` in the local retrieve domain: one complete document read in
 * source-order character windows, with parsed Markdown preferred over Zotero's
 * index text. Windows are losslessly joinable through nextStart.
 * @module tests/local/retrieve/retrieve-fulltext
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalApiProvider } from '../../../src/local/provider.js'
import type {
  FulltextEnhancer,
  FulltextLookupResult,
} from '../../../src/local/fulltext-enhancer.js'
import {
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND,
} from '../../../src/errors.js'
import { MockZotero } from '../../helpers/mock-zotero.js'
import { testHttpClient } from '../../helpers/test-clients.js'
import { PROVIDER_LIMITS } from '../../helpers/provider-harness.js'
import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'
import { attachmentRef } from '../../helpers/server/keys.js'
import { serveFulltext, serveItemGraph } from '../../helpers/server/serve.js'
import {
  FULLTEXT_PAYLOAD,
  RETRIEVE_ATTACHMENT,
  RETRIEVE_ATTACHMENT_CHILDREN,
  RETRIEVE_CHILDREN,
  RETRIEVE_PARENT,
} from './support.js'

let mock: MockZotero | undefined

afterEach(async () => {
  await mock?.close()
  mock = undefined
})

const WINDOW_CHARS = 8

function providerOf(server: MockZotero, enhancer?: FulltextEnhancer): LocalApiProvider {
  return new LocalApiProvider({
    client: testHttpClient(server.baseUrl),
    limits: () => PROVIDER_LIMITS,
    fulltextEnhancer: () => enhancer,
  })
}

async function boot(): Promise<MockZotero> {
  mock = await MockZotero.start()
  serveItemGraph(mock, {
    parent: RETRIEVE_PARENT,
    children: RETRIEVE_CHILDREN,
    annotations: RETRIEVE_ATTACHMENT_CHILDREN,
    attachmentItem: RETRIEVE_ATTACHMENT,
    serverId: null,
  })
  return mock
}

function hit(text: string): Extract<FulltextLookupResult, { kind: 'hit' }> {
  return {
    kind: 'hit',
    text,
    format: 'markdown',
    source: 'MinerU (free)',
    sourceKind: 'attachment',
    sourceLabel: attachmentRef(RETRIEVE_ATTACHMENT.key),
    provenance: {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
      sourceId: 'c'.repeat(64),
      generation: 'd'.repeat(64),
    },
  }
}

function enhancerOf(result: FulltextLookupResult | (() => FulltextLookupResult)): FulltextEnhancer {
  const resolve = async () => (typeof result === 'function' ? result() : result)
  return {
    lookup: vi.fn(resolve),
    lookupArtifact: vi.fn(resolve),
  }
}

const markdown = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

describe('mode:"fulltext" windows', () => {
  it('returns one exact character window of parsed Markdown with provenance', async () => {
    const server = await boot()
    const enhancer = enhancerOf(hit(markdown))
    const result = await providerOf(server, enhancer).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.mode).toBe('fulltext')
    expect(result.fulltext).toMatchObject({
      sourceKind: 'attachment',
      textFormat: 'markdown',
      totalChars: markdown.length,
      inputTruncated: false,
      start: 0,
      end: WINDOW_CHARS,
      text: markdown.slice(0, WINDOW_CHARS),
      isTruncated: true,
      nextStart: WINDOW_CHARS,
      attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
    })
    expect(result.fulltext?.artifact?.artifactId).toBe('a'.repeat(64))
    expect(enhancer.lookup).toHaveBeenCalledOnce()
  })

  it('joins successive windows into the complete document without ranking or chunking', async () => {
    const server = await boot()
    const provider = providerOf(server, enhancerOf(hit(markdown)))
    let nextStart = 0
    let joined = ''
    let windows = 0
    while (true) {
      const result = await provider.retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: nextStart,
        maxChars: WINDOW_CHARS,
      })
      const read = result.fulltext!
      joined += read.text
      windows += 1
      if (!read.isTruncated) break
      nextStart = read.nextStart!
      expect(windows).toBeLessThan(10)
    }
    expect(joined).toBe(markdown)
    expect(windows).toBe(4)
  })

  it('reports an index-text fallback as text with Zotero coverage', async () => {
    const server = await boot()
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const result = await providerOf(
      server,
      enhancerOf({ kind: 'miss', reason: 'absent' }),
    ).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext).toMatchObject({
      sourceKind: 'attachment',
      textFormat: 'text',
      coverage: { complete: false },
    })
    expect(result.fulltext?.artifact).toBeUndefined()
    expect(result.fulltext?.text).toBe((FULLTEXT_PAYLOAD.content as string).slice(0, WINDOW_CHARS))
  })

  it('clamps a window past the configured bound at the domain layer', async () => {
    // A same-process caller can reach the provider without the tool; the
    // window limit is a deployment bound the domain enforces itself.
    const server = await boot()
    const result = await providerOf(server, enhancerOf(hit(markdown))).retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: PROVIDER_LIMITS.fulltextWindowChars + 1,
    })
    expect(result.fulltext?.end).toBeLessThanOrEqual(PROVIDER_LIMITS.fulltextWindowChars)
    expect(result.fulltext?.text).toBe(markdown.slice(0, PROVIDER_LIMITS.fulltextWindowChars))
  })

  it('rejects a start beyond the document at the domain layer', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf(hit(markdown))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: markdown.length + 1,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT, name: 'ZoteroError' })
  })

  it('propagates a parsed-artifact fault instead of falling back to the index', async () => {
    const server = await boot()
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const failure = new Error('artifact store unreadable')
    await expect(
      providerOf(server, enhancerOf({ kind: 'fault', error: failure })).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toBe(failure)
  })

  it('bounds the whole document by maxFulltextChars and reports inputTruncated', async () => {
    const server = await boot()
    const long = 'x'.repeat(40)
    const narrow = new LocalApiProvider({
      client: testHttpClient(server.baseUrl),
      limits: () => ({
        ...PROVIDER_LIMITS,
        maxFulltextChars: 10,
      }),
      fulltextEnhancer: () => enhancerOf(hit(long)),
    })
    const result = await narrow.retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext).toMatchObject({
      totalChars: 10,
      inputTruncated: true,
      text: 'x'.repeat(WINDOW_CHARS),
      isTruncated: true,
      nextStart: WINDOW_CHARS,
    })
  })
})

describe('mode:"fulltext" artifact sources', () => {
  it('reads a stored artifact by opaque id through lookupArtifact', async () => {
    const server = await boot()
    // The artifactId handle says nothing about the source; the lookup result
    // carries the concrete source facts the read must report.
    const enhancer = enhancerOf({
      ...hit(markdown),
      sourceKind: 'attachment',
      sourceLabel: attachmentRef(RETRIEVE_ATTACHMENT.key),
      attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
    })
    const result = await providerOf(server, enhancer).retrieve({
      mode: 'fulltext',
      source: { kind: 'artifactId', artifactId: 'e'.repeat(64) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext).toMatchObject({
      sourceKind: 'attachment',
      sourceLabel: attachmentRef(RETRIEVE_ATTACHMENT.key),
      attachmentRef: attachmentRef(RETRIEVE_ATTACHMENT.key),
      textFormat: 'markdown',
      text: markdown.slice(0, WINDOW_CHARS),
    })
    expect(enhancer.lookupArtifact).toHaveBeenCalledWith('e'.repeat(64), undefined)
    expect(enhancer.lookup).not.toHaveBeenCalled()
  })

  it('reports a URL-sourced artifact as a url source', async () => {
    const server = await boot()
    const enhancer = enhancerOf({
      ...hit(markdown),
      sourceKind: 'url',
      sourceLabel: 'https://example.org/…',
    })
    const result = await providerOf(server, enhancer).retrieve({
      mode: 'fulltext',
      source: { kind: 'artifactId', artifactId: 'e'.repeat(64) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext).toMatchObject({
      sourceKind: 'url',
      sourceLabel: 'https://example.org/…',
    })
    expect(result.fulltext?.attachmentRef).toBeUndefined()
  })

  it('fails closed when an artifact id has no stored Markdown', async () => {
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf({ kind: 'miss', reason: 'absent' })).retrieve({
        mode: 'fulltext',
        source: { kind: 'artifactId', artifactId: 'e'.repeat(64) },
        start: 0,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_ARTIFACT_NOT_FOUND })
  })

  it('fails closed when the enhancement slot is absent', async () => {
    const server = await boot()
    await expect(
      providerOf(server).retrieve({
        mode: 'fulltext',
        source: { kind: 'artifactId', artifactId: 'e'.repeat(64) },
        start: 0,
        maxChars: WINDOW_CHARS,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_CAPABILITY_UNAVAILABLE })
  })
})

describe('mode:"fulltext" spill', () => {
  const longText = 'x'.repeat(20_000)

  it('offers a one-handle spill of the whole bounded document on the first window', async () => {
    const server = await boot()
    const spill = vi.fn(async () => ({
      locator: 'spill://doc/full.md',
      bytes: longText.length,
      retrievalHint: 'Read it from spill storage.',
    }))
    const result = await providerOf(server, enhancerOf(hit(longText))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: WINDOW_CHARS,
      },
      undefined,
      spill,
    )
    expect(spill).toHaveBeenCalledOnce()
    expect(spill).toHaveBeenCalledWith(longText)
    expect(result.fulltext?.spillRef).toEqual({
      locator: 'spill://doc/full.md',
      bytes: longText.length,
      retrievalHint: 'Read it from spill storage.',
    })
  })

  it('spills only on the first window so a walk does not re-save the document', async () => {
    const server = await boot()
    const spill = vi.fn(async () => ({
      locator: 'spill://doc/full.md',
      bytes: longText.length,
      retrievalHint: 'Read it.',
    }))
    const result = await providerOf(server, enhancerOf(hit(longText))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: WINDOW_CHARS,
        maxChars: WINDOW_CHARS,
      },
      undefined,
      spill,
    )
    expect(spill).not.toHaveBeenCalled()
    expect(result.fulltext?.spillRef).toBeUndefined()
  })

  it('skips the spill for a document shorter than the threshold', async () => {
    const server = await boot()
    const spill = vi.fn(async () => ({
      locator: 'spill://doc/full.md',
      bytes: 0,
      retrievalHint: 'Read it.',
    }))
    const result = await providerOf(server, enhancerOf(hit(markdown))).retrieve(
      {
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: WINDOW_CHARS,
      },
      undefined,
      spill,
    )
    expect(spill).not.toHaveBeenCalled()
    expect(result.fulltext?.spillRef).toBeUndefined()
  })
})
