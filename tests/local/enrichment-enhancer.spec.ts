/**
 * The core's optional full-text enhancer slot: with no enhancer every read is
 * the original loopback path; with one, both the `best` and multi-attachment
 * policies use its text, report a recoverable fallback through the diagnostics
 * sink, and propagate a fatal authorization failure.
 * @module tests/local/enrichment-enhancer
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalApiProvider } from '../../src/local/provider.js'
import type { DiagnosticSink } from '../../src/diagnostics.js'
import type { FulltextEnhancer } from '../../src/local/fulltext-enhancer.js'
import { ZoteroError } from '../../src/errors.js'
import { MockZotero } from '../helpers/mock-zotero.js'
import { testHttpClient } from '../helpers/test-clients.js'
import { PROVIDER_LIMITS } from '../helpers/provider-harness.js'
import { retrieveRequest } from '../helpers/provider-harness.js'
import { requestLines } from '../helpers/server/assert.js'
import { ITEM_KEY, apiPath, attachmentRef } from '../helpers/server/keys.js'
import { serveFulltext, serveItemGraph, serveJson } from '../helpers/server/serve.js'
import {
  FULLTEXT_PAYLOAD,
  RETRIEVE_ATTACHMENT,
  RETRIEVE_CHILDREN,
  RETRIEVE_PARENT,
  RETRIEVE_PARENT_WITHOUT_ATTACHMENT_TYPE,
} from './retrieve/support.js'

let mock: MockZotero | undefined
let tempDir: string | undefined

afterEach(async () => {
  await mock?.close()
  mock = undefined
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function providerOf(
  server: MockZotero,
  enhancer: FulltextEnhancer | undefined,
  sink?: DiagnosticSink,
): LocalApiProvider {
  return new LocalApiProvider(
    testHttpClient(server.baseUrl),
    () => PROVIDER_LIMITS,
    undefined,
    undefined,
    sink,
    () => enhancer,
  )
}

async function boot(): Promise<MockZotero> {
  mock = await MockZotero.start()
  tempDir = mkdtempSync(join(tmpdir(), 'dsh-zotero-enhancer-'))
  return mock
}

const enhancerOf = (
  enhance: FulltextEnhancer['enhance'],
  lookup: FulltextEnhancer['lookup'] = async () => ({ outcome: undefined }),
): FulltextEnhancer => ({ lookup, enhance })

const okEnhancer = (text: string): FulltextEnhancer =>
  enhancerOf(async () => ({ kind: 'ok', text }))

describe('the optional full-text enhancer', () => {
  it('leaves the unchained path byte-for-byte unchanged with no enhancer', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const provider = providerOf(server, undefined)

    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 2, query: 'tiling' }),
    )
    expect(result.coverage).toBeDefined()
    expect(requestLines(server)).toContain(`/api/users/0/items/${RETRIEVE_ATTACHMENT.key}/fulltext`)
  })

  it('uses the enhanced text for the best policy and skips the index read', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    serveJson(server, `${apiPath()}/items/${ITEM_KEY}`, RETRIEVE_PARENT)
    const provider = providerOf(server, okEnhancer('enhanced tiling analysis body'))

    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 2, query: 'tiling' }),
    )
    expect(result.evidence.some((entry) => entry.text.includes('enhanced tiling'))).toBe(true)
    // MinerU text has no Zotero index coverage, so the result must not claim one.
    expect(result.coverage).toBeUndefined()
    expect(requestLines(server)).not.toContain(
      `/api/users/0/items/${RETRIEVE_ATTACHMENT.key}/fulltext`,
    )
  })

  it('uses the enhanced text for the allIndexed policy', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    const provider = providerOf(server, okEnhancer('enhanced multi attachment body tiling'))

    const result = await provider.retrieve(
      retrieveRequest({
        sources: ['fulltext'],
        attachmentPolicy: 'allIndexed',
        passages: 2,
        query: 'tiling',
      }),
    )
    expect(result.evidence.some((entry) => entry.text.includes('enhanced multi'))).toBe(true)
    expect(requestLines(server)).not.toContain(
      `/api/users/0/items/${RETRIEVE_ATTACHMENT.key}/fulltext`,
    )
  })

  it('offers an empty content-type link attachment to the enhancer', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT_WITHOUT_ATTACHMENT_TYPE,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    const seen: Array<string | undefined> = []
    const provider = providerOf(
      server,
      enhancerOf(async (input) => {
        seen.push(input.contentType)
        return { kind: 'ok', text: 'enhanced empty type tiling body' }
      }),
    )

    const result = await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 2, query: 'tiling' }),
    )
    expect(seen).toEqual([''])
    expect(result.evidence.some((entry) => entry.text.includes('enhanced empty type'))).toBe(true)
    expect(requestLines(server)).not.toContain(
      `/api/users/0/items/${RETRIEVE_ATTACHMENT.key}/fulltext`,
    )
  })

  it('propagates MinerU runtime failures without querying the local index', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const warn = vi.fn()
    const sink = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as DiagnosticSink
    const provider = providerOf(
      server,
      enhancerOf(async () => ({ kind: 'fatal', error: new Error('MinerU is rate limited') })),
      sink,
    )

    await expect(
      provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 2, query: 'tiling' })),
    ).rejects.toThrow('MinerU is rate limited')
    // A MinerU failure must not be replaced with local index text.
    expect(
      requestLines(server).some((line) =>
        line.includes(`/items/${RETRIEVE_ATTACHMENT.key}/fulltext`),
      ),
    ).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('propagates a fatal authorization failure instead of degrading', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const fatal = new ZoteroError('token missing', 'ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED')
    const provider = providerOf(
      server,
      enhancerOf(async () => ({ kind: 'fatal', error: fatal })),
    )

    await expect(
      provider.retrieve(retrieveRequest({ sources: ['fulltext'], passages: 2, query: 'tiling' })),
    ).rejects.toMatchObject({ code: 'ZOTERO_ENRICHMENT_CREDENTIAL_UNRESOLVED' })
  })

  it('offers the enhancer the attachment identity it needs to resolve bytes', async () => {
    const server = await boot()
    serveItemGraph(server, {
      parent: RETRIEVE_PARENT,
      children: RETRIEVE_CHILDREN,
      serverId: null,
    })
    const seen: string[] = []
    const provider = providerOf(
      server,
      enhancerOf(async (input) => {
        seen.push(`${input.source.kind}:${input.key}`)
        return { kind: 'ok', text: 'tiling evidence' }
      }),
    )
    serveFulltext(server, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)

    await provider.retrieve(
      retrieveRequest({ sources: ['fulltext'], passages: 1, query: 'tiling' }),
    )
    expect(seen).toEqual([`local:${attachmentRef(RETRIEVE_ATTACHMENT.key)}`])
  })
})
