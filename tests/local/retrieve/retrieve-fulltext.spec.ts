import { describe, expect, it, vi } from 'vitest'
import { LocalApiProvider } from '../../../src/local/provider.js'

import { testHttpClient } from '../../helpers/test-clients.js'
import { PROVIDER_LIMITS } from '../../helpers/provider-harness.js'
import { ZOTERO_INVALID_ARGUMENT } from '../../../src/errors.js'
import { attachmentRef } from '../../helpers/server/keys.js'

import { serveFulltext } from '../../helpers/server/serve.js'

import {
  FULLTEXT_PAYLOAD,
  RETRIEVE_ATTACHMENT,
  RETRIEVE_PARENT,
} from '../../helpers/retrieve-fixtures.js'

import { WINDOW_CHARS, providerOf, boot, hit, enhancerOf, markdown } from './support/fulltext.js'

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
    expect(result.fulltext?.item?.ref).toBe(`zotero://user/0/item/${RETRIEVE_PARENT.key}`)
    expect(result.fulltext?.attachmentContentType).toBe('application/pdf')
    expect(result.fulltext?.artifact?.artifactId).toBe('a'.repeat(64))
    expect(enhancer.lookup).toHaveBeenCalledOnce()
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

  it('rejects an oversized window at the domain layer before source I/O', async () => {
    // A same-process caller can reach the provider without the tool; the
    // window limit is a deployment bound the domain enforces itself.
    const server = await boot()
    await expect(
      providerOf(server, enhancerOf(hit(markdown))).retrieve({
        mode: 'fulltext',
        source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
        start: 0,
        maxChars: PROVIDER_LIMITS.fulltextWindowChars + 1,
      }),
    ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
    expect(server.requests).toHaveLength(0)
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

  it('never admits a ranking scope for a fulltext window', async () => {
    // Ranking admission is the evidence mode's model-commitment point. A
    // fulltext read only copies characters, so the ranker must stay untouched:
    // a throwing `admit` is how this test would notice the opposite.
    const server = await boot()
    const admit = vi.fn((): never => {
      throw new Error('fulltext reads must not admit a ranking scope')
    })
    const rank = vi.fn(async () => ({ matches: [], routes: ['lexical'] as const }))
    const provider = new LocalApiProvider({
      client: testHttpClient(server.baseUrl),
      limits: () => PROVIDER_LIMITS,
      fulltextEnhancer: () => enhancerOf(hit(markdown)),
      evidenceRanker: () => ({ admit, rank }),
    })
    const result = await provider.retrieve({
      mode: 'fulltext',
      source: { kind: 'ref', ref: attachmentRef(RETRIEVE_ATTACHMENT.key) },
      start: 0,
      maxChars: WINDOW_CHARS,
    })
    expect(result.fulltext?.text).toBe(markdown.slice(0, WINDOW_CHARS))
    expect(admit).not.toHaveBeenCalled()
    expect(rank).not.toHaveBeenCalled()
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
