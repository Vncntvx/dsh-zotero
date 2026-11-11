/**
 * Ordinary reads through the real ZoteroService consume artifacts produced by
 * an earlier explicit parse. The real artifact store and source index are
 * seeded through their public writes. The MinerU transport is the external
 * boundary. Parsing fails the test rather than generating fixtures.
 * @module tests/host/enrichment-end-to-end
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/index.ts'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { cacheKeyOf, type parseOnce } from '../../src/enrichment/parse-once.ts'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.ts'
import { MineruClient } from '../../src/enrichment/transport.ts'
import type { ParsedArtifact } from '../../src/enrichment/types.ts'
import type { ZoteroRetrieveResult } from '../../src/types.ts'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { requestLines } from '../helpers/server/assert.ts'
import { attachment, paperItem } from '../helpers/server/objects.ts'
import { serveFulltext, serveItemGraph } from '../helpers/server/serve.ts'
import { ATTACHMENT_KEY, ITEM_KEY, attachmentRef } from '../helpers/server/keys.ts'

const pdf = new TextEncoder().encode('%PDF-1.7 previously parsed document')
const pdfUrl = 'https://example.org/paper.pdf'
const identity = attachmentRef(ATTACHMENT_KEY)
const generation = '489d1080-7d53-4f88-bf4d-ef346e07b144'
let lane: HostLane | undefined
let tempDir: string | undefined

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

async function boot(allowDocumentUpload = true) {
  tempDir = mkdtempSync(join(tmpdir(), 'dsh-zotero-enrichment-e2e-'))
  const store = new ParsedArtifactStore(tempDir)
  const parse = vi.fn<typeof parseOnce>(async () => {
    throw new Error('ordinary reading cannot start a parse without an explicit user operation')
  })
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'HEAD') throw new Error('ordinary reading must not download or upload')
    return new Response(null, {
      headers: { etag: '"v1"', 'content-length': String(pdf.byteLength) },
    })
  })
  const client = new MineruClient({
    fetch,
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    dispatcher: () => ({ dispatcher: {}, close: async () => {} }),
  })
  const get = vi.spyOn(client, 'get')
  const head = vi.spyOn(client, 'head')
  const post = vi.spyOn(client, 'json')
  lane = await setupHostLane(
    {},
    {
      compose: async (ctx) => {
        new EnrichmentService(
          ctx,
          { allowDocumentUpload, outputDir: tempDir },
          {
            client,
            parse,
            store: async () => store,
          },
        )
      },
    },
  )
  const parent = paperItem({ meta: { numChildren: 1 } })
  const linked = attachment({
    data: {
      parentItem: ITEM_KEY,
      linkMode: 'linked_url',
      url: pdfUrl,
      contentType: 'application/pdf',
    },
  })
  serveItemGraph(lane.mock, {
    parent,
    attachmentItem: linked,
    children: [linked],
    serverId: null,
  })
  return { lane, store, parse, fetch, get, head, post }
}

async function seedArtifact(store: ParsedArtifactStore): Promise<ParsedArtifact> {
  // A prior explicit parse produced these exact bytes. Use the public durable
  // store writes; no private service parser or parseOnce substitute creates it.
  const fingerprint = createHash('sha256').update(pdf).digest('hex')
  const mode = 'free'
  const artifact: ParsedArtifact = {
    markdown: '# Cached MinerU tiling body\n\n' + 'tiling evidence '.repeat(80),
    meta: {
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId: sourceKeyOf(identity),
      generation,
      identity,
      mode,
      contentFingerprint: fingerprint,
      taskId: 'already-generated-task',
      files: ['full.md'],
    },
  }
  const cacheKey = cacheKeyOf({
    identity,
    mode,
    generation,
    fingerprint,
  })
  await store.put(cacheKey, artifact)
  await store.putSource(sourceKeyOf(identity), {
    version: 2,
    generation,
    parser: 'mineru',
    format: 'markdown',
    cacheKey,
    fingerprint,
    stamp: { kind: 'url', url: pdfUrl, etag: '"v1"', contentLength: pdf.byteLength },
  })
  return artifact
}

async function read(host: HostLane): Promise<ZoteroRetrieveResult> {
  const result = expectValue(
    await host.runTool('zotero_retrieve', {
      ref: `zotero://user/0/item/${ITEM_KEY}`,
      query: 'tiling',
      sources: ['fulltext'],
      passages: 2,
    }),
    'zotero_retrieve',
  )
  return result.value as unknown as ZoteroRetrieveResult
}

describe('cached enrichment through a real ZoteroService', () => {
  it.each([true, false])(
    'serves a previously generated artifact twice without parsing when upload permission is %s',
    async (allowDocumentUpload) => {
      const { lane, store, parse, fetch, get, head, post } = await boot(allowDocumentUpload)
      await seedArtifact(store)

      const first = await read(lane)
      expect(first.evidence.some((entry) => entry.text.includes('Cached MinerU tiling'))).toBe(true)
      expect(first.coverage).toBeUndefined()
      expect(head).toHaveBeenCalledTimes(1)
      expect(get).not.toHaveBeenCalled()
      expect(parse).not.toHaveBeenCalled()
      expect(post).not.toHaveBeenCalled()
      expect(requestLines(lane.mock).some((line) => line.includes('/fulltext'))).toBe(false)

      const second = await read(lane)
      expect(second.evidence).toEqual(first.evidence)
      expect(second.coverage).toBeUndefined()
      expect(head).toHaveBeenCalledTimes(2)
      expect(get).not.toHaveBeenCalled()
      expect(parse).not.toHaveBeenCalled()
      expect(post).not.toHaveBeenCalled()
      expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
        [pdfUrl, 'HEAD'],
        [pdfUrl, 'HEAD'],
      ])
      expect(requestLines(lane.mock).some((line) => line.includes('/fulltext'))).toBe(false)
    },
  )

  it('uses the Zotero index on an absent source record without a HEAD or parse', async () => {
    const { lane, parse, fetch, get, head, post } = await boot()
    serveFulltext(lane.mock, ATTACHMENT_KEY, {
      content: 'Original Zotero index tiling evidence',
      indexedPages: 1,
      totalPages: 1,
    })

    const result = await read(lane)
    expect(result.evidence.map((entry) => entry.text)).toEqual([
      'Original Zotero index tiling evidence',
    ])
    expect(result.coverage).toMatchObject({ indexedPages: 1, totalPages: 1, complete: true })
    expect(requestLines(lane.mock)).toContain(`/api/users/0/items/${ATTACHMENT_KEY}/fulltext`)
    expect(head).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(parse).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
