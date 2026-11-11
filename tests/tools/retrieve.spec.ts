/**
 * The `zotero_retrieve` tool surface: ranked evidence and coverage end to
 * end, attachment-policy and argument validations, and the evidence render
 * with its coverage, locators, skipped sources, and cut flags.
 * @module tests/tools/retrieve
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { FulltextArtifactProvenance } from '../../src/local/fulltext-enhancer.js'
import { buildSourceWorkspace } from '../../src/sources/ledger.js'
import { sourceWorkspaceSchema } from '../../src/sources/workspace-schema.js'
import type { ToolBlockLike } from '../../src/sources/block-types.js'
import { ITEM_KEY, attachmentRef, itemRef } from '../helpers/server/keys.js'
import { serveItemGraph } from '../helpers/server/serve.js'
import { invalidRefMessage } from '../../src/refs.js'
import {
  attachmentRefsLibraryMessage,
  attachmentRefsOverCapMessage,
  RETRIEVE_QUERY_EMPTY_MESSAGE,
  RETRIEVE_SOURCES_EMPTY_MESSAGE,
  RETRIEVE_SPECIFIED_EMPTY_MESSAGE,
  RETRIEVE_SPECIFIED_ONLY_MESSAGE,
} from '../../src/tools/retrieve.js'
import { queryVariantsOverCapMessage } from '../../src/tools/query-variants.js'
import { ZOTERO_MAX_QUERY_VARIANTS } from '../../src/constants.js'
import { intRangeArgumentMessage } from '../../src/tools/validate.js'
import { expectValue, type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'
import { serveChildrenContract } from '../helpers/server/children-contract.js'
import { searchHit } from '../helpers/server/objects.js'

let lane: HostLane
let mock: HostLane['mock']
let runTool: HostLane['runTool']

beforeEach(async () => {
  lane = await setupHostLane()
  mock = lane.mock
  runTool = lane.runTool
})

afterEach(async () => {
  await lane.teardown()
})

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
  meta: { parsedDate: '2023-07-28', numChildren: 1 },
  data: {
    itemType: 'journalArticle',
    title: 'FlashAttention-2',
    abstractNote: 'FlashAttention speeds up transformer training.',
    collections: [],
  },
}

const RETRIEVE_CHILDREN = [
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

/** Annotations live under the PDF attachment (`WXYZ6789`), not under the parent. */
const RETRIEVE_ATTACHMENT_CHILDREN = [
  {
    key: 'ANNO1111',
    data: {
      itemType: 'annotation',
      annotationType: 'highlight',
      annotationText: 'flash attention avoids materializing the matrix',
      annotationSortIndex: '00001',
      parentItem: 'WXYZ6789',
    },
  },
]

describe('zotero_retrieve tool', () => {
  it('registers and exposes its schema to the assembly', () => {
    expect(lane.tool('zotero_retrieve')).toBeDefined()
    expect(lane.ctx.tools.schemas().some((schema) => schema.name === 'zotero_retrieve')).toBe(true)
  })

  it('returns ranked evidence and coverage', async () => {
    mock.route('GET', '/api/users/0/items/ABCD1234', (req, res, helpers) =>
      helpers.json(RETRIEVE_PARENT, { 'Zotero-Server-ID': 'S1' }),
    )
    serveChildrenContract(mock, '/api/users/0/items/ABCD1234/children', {
      direct: RETRIEVE_CHILDREN,
      annotations: RETRIEVE_ATTACHMENT_CHILDREN,
    })
    mock.route('GET', '/api/users/0/items/WXYZ6789/fulltext', (req, res, helpers) =>
      helpers.json({
        content: 'Flash attention is fast. Attention is all you need.',
        indexedChars: 100,
        totalChars: 100,
      }),
    )
    const result = expectValue(
      await runTool('zotero_retrieve', {
        ref: 'zotero://user/0/item/ABCD1234',
        query: 'flash attention',
        passages: 3,
      }),
      'zotero_retrieve',
    )
    const value = result.value as {
      evidence: { source: string; text: string }[]
      coverage: { complete: boolean }
      truncated: boolean
    }
    expect(value.evidence.length).toBeGreaterThan(0)
    expect(value.coverage.complete).toBe(true)
    expect(value.truncated).toBe(false)
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('zotero://user/0/item/ABCD1234?server=S1')
    expect(text).toContain('fulltext')
  })

  it('retains distinct artifact generations through tool output and the source ledger', async () => {
    serveItemGraph(mock, { serverId: null })
    const text = `\n\n# Attention results\n\n${'attention  **evidence**\n'.repeat(40)}`
    const provenance: FulltextArtifactProvenance = {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'artifact-first',
      fingerprint: 'a'.repeat(64),
      sourceId: 'b'.repeat(64),
      generation: 'c'.repeat(64),
    }
    let current = provenance
    lane.ctx.zotero.setFulltextEnhancer({
      async lookup() {
        return {
          kind: 'hit',
          text,
          format: 'markdown',
          source: 'MinerU (free)',
          provenance: current,
        }
      },
    })
    const args = {
      ref: itemRef(ITEM_KEY),
      query: 'attention',
      sources: ['fulltext'],
      attachmentPolicy: 'allIndexed',
    }
    const blocks: ToolBlockLike[] = []
    for (const [index, generation] of [
      provenance.generation,
      provenance.generation,
      'd'.repeat(64),
    ].entries()) {
      // Identical body and artifact key still represent a distinct generation.
      current = { ...provenance, generation }
      const result = expectValue(await runTool('zotero_retrieve', args), 'zotero_retrieve')
      expect(result.value).toMatchObject({
        textFormat: 'markdown',
        artifact: current,
        attachments: [{ textFormat: 'markdown', artifact: current }],
        evidence: [
          {
            textFormat: 'markdown',
            artifact: current,
            start: expect.any(Number),
            end: expect.any(Number),
          },
        ],
      })
      blocks.push({
        kind: 'tool-result',
        callId: `artifact-${index}`,
        seq: index,
        time: index,
        name: 'zotero_retrieve',
        args: PartialArguments.fromText(JSON.stringify(args)),
        call: { name: 'zotero_retrieve', argsRaw: JSON.stringify(args) },
        callTime: index,
        content: result.content,
        isError: false,
        meta: result.meta,
        subCalls: [],
      })
    }

    const workspace = sourceWorkspaceSchema.parse(buildSourceWorkspace(blocks))
    const evidence = workspace.sources[0]!.evidence
    expect(evidence).toHaveLength(2)
    expect(evidence.map((entry) => entry.artifact?.generation)).toEqual([
      provenance.generation,
      'd'.repeat(64),
    ])
    expect(evidence.map((entry) => entry.callIds)).toEqual([
      ['artifact-0', 'artifact-1'],
      ['artifact-2'],
    ])
    for (const entry of evidence) {
      expect(entry).toMatchObject({
        source: 'fulltext',
        sourceRef: attachmentRef(),
        textFormat: 'markdown',
        artifact: { ...provenance, generation: entry.artifact!.generation },
        previewTruncated: true,
      })
      expect(entry.start).toEqual(expect.any(Number))
      expect(entry.end).toEqual(expect.any(Number))
      expect(text.slice(entry.start, entry.end).startsWith(entry.text)).toBe(true)
      expect(entry.end! - entry.start!).toBeGreaterThan(entry.text.length)
      expect(entry.pageLabel).toBeUndefined()
    }
    expect(mock.requests.some((entry) => entry.pathname.endsWith('/fulltext'))).toBe(false)
  })

  it('searches My Publications end to end through the tool', async () => {
    mock.route('GET', '/api/users/0/publications/items', (req, res, helpers) =>
      helpers.json([searchHit()], { 'Total-Results': '1' }),
    )
    const result = expectValue(
      await runTool('zotero_search', { scope: { kind: 'publications' } }),
      'zotero_search',
    )
    expect(mock.requests[0]!.pathname).toBe('/api/users/0/publications/items')
    const value = result.value as { scope: { kind: string } }
    expect(value.scope.kind).toBe('publications')
  })

  it('rejects empty queries and out-of-range passage counts before any request', async () => {
    const empty = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: '   ',
    })
    expect(empty.isError).toBe(true)
    if (!empty.isError) throw new Error('unreachable')
    expect((empty.content[0] as { text: string }).text).toContain(RETRIEVE_QUERY_EMPTY_MESSAGE)

    const tooMany = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      passages: 5,
    })
    expect(tooMany.isError).toBe(true)
    if (!tooMany.isError) throw new Error('unreachable')
    expect((tooMany.content[0] as { text: string }).text).toContain(
      intRangeArgumentMessage('passages', 5, 1, 4),
    )

    expect(mock.requests).toEqual([])
  })

  it('validates attachment policy pairings before any request', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [
        {
          ref: 'zotero://user/0/item/ABCD1234',
          query: 'x',
          attachmentPolicy: 'specified',
        },
        RETRIEVE_SPECIFIED_EMPTY_MESSAGE,
      ],
      [
        {
          ref: 'zotero://user/0/item/ABCD1234',
          query: 'x',
          attachmentRefs: ['zotero://user/0/attachment/WXYZ6789'],
        },
        RETRIEVE_SPECIFIED_ONLY_MESSAGE,
      ],
      [
        {
          ref: 'zotero://group/7/item/ABCD1234',
          query: 'x',
          attachmentPolicy: 'specified',
          attachmentRefs: ['zotero://group/8/attachment/WXYZ6789'],
        },
        attachmentRefsLibraryMessage('group/7'),
      ],
      [
        {
          ref: 'zotero://user/0/item/ABCD1234',
          query: 'x',
          attachmentPolicy: 'specified',
          attachmentRefs: ['zotero://user/0/item/WXYZ6789'],
        },
        'Expected a attachment reference',
      ],
    ]
    for (const [args, message] of cases) {
      const result = await runTool('zotero_retrieve', args)
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('unreachable')
      expect((result.content[0] as { text: string }).text).toContain(message)
    }
    expect(mock.requests).toEqual([])
  })

  it('caps the attachment list at distinct refs and reads each one once', async () => {
    const attachmentRef = (index: number): string =>
      `zotero://user/0/attachment/A${String(index).padStart(7, '0')}`
    // Seventeen distinct attachments are more than one ranking may hold.
    const overCap = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      attachmentPolicy: 'specified',
      attachmentRefs: Array.from({ length: 17 }, (_, index) => attachmentRef(index)),
    })
    expect(overCap.isError).toBe(true)
    if (!overCap.isError) throw new Error('unreachable')
    expect((overCap.content[0] as { text: string }).text).toContain(
      attachmentRefsOverCapMessage(17, 16),
    )
    expect(mock.requests).toEqual([])

    // The same attachment repeated is one attachment, not a list over the cap:
    // the call proceeds to the API, where the unscripted mock answers 404.
    const repeated = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      attachmentPolicy: 'specified',
      attachmentRefs: Array.from({ length: 17 }, () => attachmentRef(0)),
    })
    expect(repeated.isError).toBe(true)
    if (!repeated.isError) throw new Error('unreachable')
    const text = (repeated.content[0] as { text: string }).text
    expect(text).not.toContain('at most')
    expect(mock.requests.map((entry) => entry.pathname)).toEqual(['/api/users/0/items/ABCD1234'])
  })

  it('rejects an empty sources list', async () => {
    const result = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      sources: [],
    })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(RETRIEVE_SOURCES_EMPTY_MESSAGE)
    expect(mock.requests).toEqual([])
  })

  it('bounds the paraphrase list and refuses a blank one', async () => {
    const overCap = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      queryVariants: ['a', 'b', 'c', 'd', 'e'],
    })
    expect(overCap.isError).toBe(true)
    if (!overCap.isError) throw new Error('unreachable')
    expect((overCap.content[0] as { text: string }).text).toContain(
      queryVariantsOverCapMessage(ZOTERO_MAX_QUERY_VARIANTS),
    )

    const blank = await runTool('zotero_retrieve', {
      ref: 'zotero://user/0/item/ABCD1234',
      query: 'x',
      queryVariants: ['  '],
    })
    expect(blank.isError).toBe(true)
    if (!blank.isError) throw new Error('unreachable')
    expect((blank.content[0] as { text: string }).text).toContain('queryVariants entry')
    // Both rejections happen before any request leaves the host.
    expect(mock.requests).toEqual([])
  })

  it('rejects malformed refs before any request', async () => {
    const result = await runTool('zotero_retrieve', { ref: 'nope', query: 'x' })
    expect(result.isError).toBe(true)
    if (!result.isError) throw new Error('unreachable')
    expect((result.content[0] as { text: string }).text).toContain(invalidRefMessage('nope'))
    expect(mock.requests).toEqual([])
  })

  it('declares itself concurrency-safe for valid arguments', () => {
    expect(
      lane
        .tool('zotero_retrieve')!
        .isConcurrencySafe?.({ ref: 'zotero://user/0/item/ABCD1234', query: 'x' }),
    ).toBe(true)
  })
})
