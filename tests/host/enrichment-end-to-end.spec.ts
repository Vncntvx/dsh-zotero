/**
 * The enrichment seam end to end: a real `ZoteroService` reads
 * `EnrichmentService.enhancer` through the live provider slot, `zotero_retrieve`
 * consumes the parsed text, and a second read is served from the source index
 * without downloading the PDF again. The MinerU client and parse body are
 * injected so the test never opens a socket or runs a real parse.
 * @module tests/host/enrichment-end-to-end
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnrichmentService } from '../../src/enrichment/index.ts'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import {
  cacheKeyOf,
  type ParseOnceDeps,
  type ParseOnceInput,
} from '../../src/enrichment/parse-once.ts'
import type { MineruClient } from '../../src/enrichment/transport.ts'
import type { ParsedArtifact } from '../../src/enrichment/types.ts'
import { expectValue, setupHostLane, type HostLane } from '../helpers/lanes/host-lane.ts'
import { requestLines } from '../helpers/server/assert.ts'
import { attachment, paperItem } from '../helpers/server/objects.ts'
import { serveItemGraph } from '../helpers/server/serve.ts'
import { ATTACHMENT_KEY, ITEM_KEY } from '../helpers/server/keys.ts'

const encoder = new TextEncoder()
const PDF = encoder.encode('%PDF-1.7 end-to-end')

let lane: HostLane | undefined
let tempDir: string | undefined

afterEach(async () => {
  await lane?.teardown()
  lane = undefined
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe('enrichment through a real ZoteroService', () => {
  it('serves MinerU text on the first read and the source-index cache on the second', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dsh-zotero-enrichment-e2e-'))
    const store = new ParsedArtifactStore(tempDir)
    const artifact: ParsedArtifact = {
      markdown: `# Enhanced MinerU tiling body ${'tiling evidence '.repeat(80)}`,
      meta: {
        identity: 'zotero://user/0/attachment/ABCD1234',
        mode: 'free',
        contentFingerprint: 'f',
        taskId: 'task',
        files: [],
      },
    }
    const parse = vi.fn(async (input: ParseOnceInput, deps: ParseOnceDeps) => {
      await deps.store.put(cacheKeyOf(input), artifact)
      return artifact
    })
    const headers = new Headers({ etag: '"v1"', 'content-length': String(PDF.byteLength) })
    const get = vi.fn(async () => ({ bytes: PDF, headers }))
    const head = vi.fn(async () => ({ status: 200, headers }))
    const client = { get, head } as unknown as MineruClient

    lane = await setupHostLane(
      {},
      {
        compose: async (ctx) => {
          new EnrichmentService(
            ctx,
            { allowDocumentUpload: true, outputDir: tempDir },
            {
              client,
              parse: parse as never,
              store: async () => store,
            },
          )
        },
      },
    )

    const parent = paperItem({
      meta: { numChildren: 1 },
      links: {
        attachment: {
          href: `http://localhost:23119/api/users/0/items/${ATTACHMENT_KEY}`,
          type: 'application/json',
        },
      },
    })
    const linked = attachment({
      key: ATTACHMENT_KEY,
      data: {
        parentItem: ITEM_KEY,
        linkMode: 'linked_url',
        url: 'https://example.org/paper.pdf',
        contentType: 'application/pdf',
      },
    })
    serveItemGraph(lane.mock, { parent, attachmentItem: linked, serverId: null })

    const first = expectValue(
      await lane.runTool('zotero_retrieve', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        query: 'tiling',
        sources: ['fulltext'],
        passages: 2,
      }),
      'zotero_retrieve',
    )
    const firstEvidence = (first.value as { evidence: Array<{ text: string }> }).evidence
    expect(firstEvidence.some((entry) => entry.text.includes('Enhanced MinerU'))).toBe(true)
    expect(requestLines(lane.mock).some((line) => line.includes('/fulltext'))).toBe(false)
    expect(get).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledTimes(1)

    const second = expectValue(
      await lane.runTool('zotero_retrieve', {
        ref: `zotero://user/0/item/${ITEM_KEY}`,
        query: 'tiling',
        sources: ['fulltext'],
        passages: 2,
      }),
      'zotero_retrieve',
    )
    const secondEvidence = (second.value as { evidence: Array<{ text: string }> }).evidence
    expect(secondEvidence.some((entry) => entry.text.includes('Enhanced MinerU'))).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(head).toHaveBeenCalledTimes(2)
  })
})
