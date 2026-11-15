/**
 * The `zotero_retrieve` tool's `mode:"fulltext"` surface: mode exclusivity,
 * one inline character window, and a model-facing render that tells the agent
 * how to continue. Delivery must stay inline even for a large document because
 * the window, not the whole document, is what crosses the tool boundary.
 * @module tests/tools/retrieve-fulltext
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolResult } from '@deepseek-ai/dsh-tools'
import type { HostLane } from '../helpers/lanes/host-lane.js'
import { setupHostLane } from '../helpers/lanes/host-lane.js'
import { serveFulltext, serveItemGraph } from '../helpers/server/serve.js'
import { attachmentRef, itemRef } from '../helpers/server/keys.js'
import type { FulltextEnhancer, FulltextLookupResult } from '../../src/local/fulltext-enhancer.js'
import {
  FULLTEXT_PAYLOAD,
  RETRIEVE_ATTACHMENT,
  RETRIEVE_ATTACHMENT_CHILDREN,
  RETRIEVE_CHILDREN,
  RETRIEVE_PARENT,
} from '../local/retrieve/support.js'
import {
  RETRIEVE_EVIDENCE_REQUIRED_MESSAGE,
  RETRIEVE_MAX_CHARS_MESSAGE,
  RETRIEVE_MODE_MIXED_MESSAGE,
  RETRIEVE_SOURCE_REQUIRED_MESSAGE,
  FULLTEXT_TRUNCATED_REMEDY,
} from '../../src/tools/retrieve.js'

let lane: HostLane

const REF = attachmentRef(RETRIEVE_ATTACHMENT.key)
const MARKDOWN = 'one two three four five six seven eight nine ten eleven twelve'

function enhancer(text: string): FulltextEnhancer {
  const hit: Extract<FulltextLookupResult, { kind: 'hit' }> = {
    kind: 'hit',
    text,
    format: 'markdown',
    source: 'MinerU (free)',
    sourceKind: 'attachment',
    sourceLabel: REF,
    attachmentRef: REF,
    provenance: {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
      sourceId: 'c'.repeat(64),
      generation: 'd'.repeat(64),
    },
  }
  const resolve = vi.fn(async () => hit)
  return { lookup: resolve, lookupArtifact: resolve }
}

beforeEach(async () => {
  lane = await setupHostLane({ fulltextWindowChars: 12 })
  serveItemGraph(lane.mock, {
    parent: RETRIEVE_PARENT,
    children: RETRIEVE_CHILDREN,
    annotations: RETRIEVE_ATTACHMENT_CHILDREN,
    attachmentItem: RETRIEVE_ATTACHMENT,
    serverId: null,
  })
})

afterEach(async () => {
  await lane.teardown()
})

function installEnhancer(text: string): FulltextEnhancer {
  const installed = enhancer(text)
  lane.ctx.zotero.setFulltextEnhancer(installed)
  return installed
}

describe('mode exclusivity', () => {
  it('rejects evidence-only parameters in fulltext mode', async () => {
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      source: { kind: 'ref', ref: REF },
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(RETRIEVE_MODE_MIXED_MESSAGE)
  })

  it('rejects fulltext-only parameters in evidence mode', async () => {
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'evidence',
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      start: 0,
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(RETRIEVE_MODE_MIXED_MESSAGE)
  })

  it('takes an omitted mode as evidence mode', async () => {
    // `mode` is optional so that the calls documented before fulltext existed
    // keep working: the default resolves in buildRequest, not in the schema.
    const result = await lane.runTool('zotero_retrieve', {
      ref: itemRef(RETRIEVE_PARENT.key),
      query: 'attention',
      sources: ['annotation'],
    })
    expect(result.isError).toBe(false)
    const wrapped = result.value as { delivery: string; data: Record<string, unknown> }
    expect(wrapped.delivery).toBe('inline')
    expect(wrapped.data.mode).toBe('evidence')
    expect('fulltext' in wrapped.data).toBe(false)
  })

  it('requires exactly one fulltext source', async () => {
    for (const source of [
      undefined,
      { kind: 'ref' },
      { kind: 'artifactId' },
      { kind: 'ref', ref: REF, artifactId: 'a'.repeat(64) },
    ]) {
      const result = await lane.runTool('zotero_retrieve', {
        mode: 'fulltext',
        ...(source === undefined ? {} : { source }),
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain(
        RETRIEVE_SOURCE_REQUIRED_MESSAGE,
      )
    }
  })

  it('rejects a malformed artifactId as an invalid argument before any lookup', async () => {
    const enhancer = installEnhancer(MARKDOWN)
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'artifactId', artifactId: 'NOT-HEX' },
    })
    expect(result.isError).toBe(true)
    expect(result.error?.info).toMatchObject({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
    expect((result.content[0] as { text: string }).text).toContain('64-character')
    // The doomed lookup never reached the provider.
    expect(enhancer.lookupArtifact).not.toHaveBeenCalled()
    expect(enhancer.lookup).not.toHaveBeenCalled()
  })

  it('requires ref and query in evidence mode', async () => {
    for (const args of [
      { mode: 'evidence', query: 'x' },
      { mode: 'evidence', ref: 'zotero://user/0/item/ABCD1234' },
    ]) {
      const result = await lane.runTool('zotero_retrieve', args)
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toContain(
        RETRIEVE_EVIDENCE_REQUIRED_MESSAGE,
      )
    }
  })

  it('bounds maxChars by fulltextWindowChars', async () => {
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'ref', ref: REF },
      maxChars: 13,
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain(RETRIEVE_MAX_CHARS_MESSAGE)
  })
})

describe('fulltext delivery', () => {
  it('delivers a window inline and renders the continuation instruction', async () => {
    installEnhancer(MARKDOWN)
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'ref', ref: REF },
      start: 0,
    })
    expect(result.isError).toBe(false)
    const wrapped = result.value as { delivery: string; data: Record<string, unknown> }
    expect(wrapped.delivery).toBe('inline')
    const data = wrapped.data as {
      mode: string
      fulltext: { text: string; isTruncated: boolean; nextStart: number; textFormat: string }
    }
    expect(data.mode).toBe('fulltext')
    expect('evidence' in data).toBe(false)
    expect(data.fulltext.textFormat).toBe('markdown')
    expect(data.fulltext.text).toBe(MARKDOWN.slice(0, 12))
    expect(data.fulltext.isTruncated).toBe(true)
    expect(data.fulltext.nextStart).toBe(12)
    const rendered = JSON.stringify(result.content)
    expect(rendered).toContain(FULLTEXT_TRUNCATED_REMEDY)
    expect(rendered).toContain('nextStart=12')
  })

  it('stays inline for a document larger than the whole inline byte budget', async () => {
    installEnhancer('z'.repeat(200_000))
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'ref', ref: REF },
      start: 0,
    })
    expect(result.isError).toBe(false)
    expect((result.value as { delivery: string }).delivery).toBe('inline')
  })

  it('reports Zotero index text when no parsed artifact exists', async () => {
    serveFulltext(lane.mock, RETRIEVE_ATTACHMENT.key, FULLTEXT_PAYLOAD)
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'ref', ref: REF },
      start: 0,
    })
    expect(result.isError).toBe(false)
    const data = (result.value as { data: { fulltext: { textFormat: string } } }).data
    expect(data.fulltext.textFormat).toBe('text')
  })
})

describe('fulltext result card', () => {
  const args = {
    mode: 'fulltext',
    source: { kind: 'ref', ref: REF },
    start: 0,
  }
  const ok = (meta: Record<string, unknown>): ToolResult => ({
    content: [{ type: 'text', text: 'x' }],
    isError: false,
    meta: meta as ToolResult['meta'],
  })
  const present = (result: ToolResult) => lane.tool('zotero_retrieve')!.presentResult!(args, result)

  it('names the window in the completed card', () => {
    expect(
      present(
        ok({ mode: 'fulltext', fulltextRead: { start: 0, end: 12_000, totalChars: 40_000 } }),
      ),
    ).toEqual({
      card: 'generic',
      title: 'Zotero full text: characters 0–12000 of 40000',
    })
  })

  it('falls back to no card when the fulltext arm has no fact', () => {
    expect(present(ok({ mode: 'fulltext' }))).toBeUndefined()
  })

  it('falls back to no card when the result has no meta', () => {
    expect(present({ content: [], isError: false })).toBeUndefined()
  })

  it('falls back to no card when the window span is incomplete', () => {
    expect(present(ok({ mode: 'fulltext', fulltextRead: {} }))).toBeUndefined()
    expect(present(ok({ mode: 'fulltext', fulltextRead: { start: 0, end: 10 } }))).toBeUndefined()
  })
})

describe('fulltext pending card', () => {
  const presentCall = (args: Record<string, unknown>) =>
    lane.tool('zotero_retrieve')!.presentCall!(args)

  it('names the attachment source as the raw input', () => {
    expect(
      presentCall({ mode: 'fulltext', source: { kind: 'ref', ref: REF }, start: 0 }),
    ).toMatchObject({ title: 'Read Zotero full text', rawInput: REF })
  })

  it('names the artifact id when the source has no ref', () => {
    const artifactId = 'a'.repeat(64)
    expect(
      presentCall({ mode: 'fulltext', source: { kind: 'artifactId', artifactId }, start: 0 }),
    ).toMatchObject({ rawInput: artifactId })
  })

  it('leaves the raw input empty when the source is bare', () => {
    expect(presentCall({ mode: 'fulltext', source: { kind: 'ref' }, start: 0 })).toMatchObject({
      rawInput: '',
    })
  })
})

describe('fulltext spill', () => {
  it('names a spill handle for a long document when the host store is present', async () => {
    installEnhancer('z'.repeat(20_000))
    const saveText = vi.fn(async (save: { content: string }) => ({
      locator: 'spill://session/full.md',
      bytes: save.content.length,
      retrievalHint: 'Read it from spill storage.',
    }))
    ;(lane.ctx as unknown as { provide(name: string, value: unknown): void }).provide(
      'spillStore',
      { saveText },
    )
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'ref', ref: REF },
      start: 0,
    })
    expect(result.isError).toBe(false)
    const data = (result.value as { data: { fulltext: { spillRef?: unknown } } }).data
    expect(data.fulltext.spillRef).toEqual({
      locator: 'spill://session/full.md',
      bytes: 20_000,
      retrievalHint: 'Read it from spill storage.',
    })
    expect(saveText).toHaveBeenCalledOnce()
    expect(JSON.stringify(result.content)).toContain('spill://session/full.md')
  })

  it('skips the spill on a later window', async () => {
    installEnhancer('z'.repeat(20_000))
    const saveText = vi.fn(async () => ({
      locator: 'spill://session/full.md',
      bytes: 20_000,
      retrievalHint: 'Read it.',
    }))
    ;(lane.ctx as unknown as { provide(name: string, value: unknown): void }).provide(
      'spillStore',
      { saveText },
    )
    const result = await lane.runTool('zotero_retrieve', {
      mode: 'fulltext',
      source: { kind: 'ref', ref: REF },
      start: 12,
    })
    expect(result.isError).toBe(false)
    const data = (result.value as { data: { fulltext: { spillRef?: unknown } } }).data
    expect(data.fulltext.spillRef).toBeUndefined()
    expect(saveText).not.toHaveBeenCalled()
  })
})
