/**
 * The `zotero_retrieve` tool surface: ranked evidence and coverage end to
 * end, attachment-policy and argument validations, and the evidence render
 * with its coverage, locators, skipped sources, and cut flags.
 * @module tests/tools/retrieve
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invalidRefMessage } from '../../src/refs.js'
import {
  ATTACHMENT_LIMIT_NOTE,
  ATTACHMENT_UNINDEXED_NOTE,
  attachmentRefsLibraryMessage,
  attachmentRefsOverCapMessage,
  PASSAGE_COMMENT_ONLY_CLAUSE,
  renderRetrieve,
  RETRIEVE_QUERY_EMPTY_MESSAGE,
  RETRIEVE_SOURCES_EMPTY_MESSAGE,
  RETRIEVE_SPECIFIED_EMPTY_MESSAGE,
  RETRIEVE_SPECIFIED_ONLY_MESSAGE,
  RETRIEVE_TRUNCATED_MESSAGE,
  RETRIEVE_TRUNCATED_REMEDY,
  silentAttachmentsMessage,
} from '../../src/tools/retrieve.js'
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

  it('searches My Publications end to end through the tool', async () => {
    mock.route('GET', '/api/users/0/publications/items/top', (req, res, helpers) =>
      helpers.json([searchHit()], { 'Total-Results': '1' }),
    )
    const result = expectValue(
      await runTool('zotero_search', { scope: { kind: 'publications' } }),
      'zotero_search',
    )
    expect(mock.requests[0]!.pathname).toBe('/api/users/0/publications/items/top')
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

describe('zotero_retrieve render', () => {
  function render(value: never): string {
    return (renderRetrieve({} as never, value)[0] as { text: string }).text
  }

  it('renders a minimal single abstract passage', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        { source: 'abstract', sourceRef: 'zotero://user/0/item/ABCD1234', text: 'abstract text' },
      ],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(text).toBe(
      [
        'Evidence for zotero://user/0/item/ABCD1234 (1 passage)',
        '',
        '[abstract] zotero://user/0/item/ABCD1234',
        'abstract text',
      ].join('\n'),
    )
  })

  it('renders coverage with chars, pages, unknown totals, and completeness', () => {
    const charsOnly = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 10, totalChars: 12, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(charsOnly).toContain('Indexing coverage: 10/12 chars')

    const pagesOnly = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedPages: 2, totalPages: 9, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(pagesOnly).toContain('Indexing coverage: , 2/9 pages')

    const unknownTotals = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 5, indexedPages: 3, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(unknownTotals).toContain('Indexing coverage: 5/? chars, 3/? pages')

    const complete = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 5, totalChars: 5, complete: true },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(complete).toContain('(complete)')
  })

  it('renders annotation page labels and comments', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        {
          source: 'annotation',
          sourceRef: 'zotero://user/0/item/ANNO1111',
          text: 'insight',
          comment: 'double-check',
          pageLabel: '7',
          matchedFields: ['text', 'comment'],
        },
      ],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(text).toContain('[annotation (page 7)] zotero://user/0/item/ANNO1111')
    expect(text).toContain('Comment: double-check')
    expect(text).toContain('Matched in: quoted text and the reader\u2019s comment')
  })

  it('tells the model when only the annotator\u2019s comment matched', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        {
          source: 'annotation',
          sourceRef: 'zotero://user/0/item/ANNO2222',
          text: '',
          comment: 'the sampling method looks biased',
          matchedFields: ['comment'],
        },
      ],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(text).toContain('Matched in: the reader\u2019s comment')
    expect(text).toContain(PASSAGE_COMMENT_ONLY_CLAUSE)
  })

  it('renders chunk locators and skipped sources', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        {
          source: 'note',
          sourceRef: 'zotero://user/0/item/NOTE1111',
          text: 'later chunk',
          chunkIndex: 2,
          chunkCount: 3,
        },
      ],
      truncated: false,
      sourcesSkipped: ['fulltext'],
    } as never)
    expect(text).toContain('[note, chunk 3/3] zotero://user/0/item/NOTE1111')
    expect(text).toContain('Skipped unavailable sources: fulltext')
  })

  it('renders the note-body scan limit and the per-source character cut', () => {
    const capped = render({
      ref: 'zotero://user/0/attachment/SECD0001',
      coverage: { indexedChars: 1000, totalChars: 1200, complete: false },
      evidence: [
        {
          source: 'fulltext',
          sourceRef: 'zotero://user/0/attachment/SECD0001',
          text: 'cut text',
          chunkIndex: 0,
          chunkCount: 1,
        },
      ],
      attachments: [
        {
          ref: 'zotero://user/0/attachment/SECD0001',
          contentType: 'application/pdf',
          status: 'indexed',
          coverage: { indexedChars: 1000, totalChars: 1200, complete: false },
          inputTruncated: true,
          passages: 24,
        },
        { ref: 'zotero://user/0/attachment/WXYZ6789', status: 'indexed', passages: 3 },
        {
          ref: 'zotero://user/0/attachment/WXYZ6789',
          contentType: 'application/pdf',
          status: 'unindexed',
        },
        { ref: 'zotero://user/0/attachment/THRD0001', status: 'unread' },
      ],
      truncated: true,
      sourcesSkipped: [],
    } as never)
    expect(capped).toContain('Full-text sources read (2 of 4):')
    expect(capped).toContain(
      '  - zotero://user/0/attachment/SECD0001 (application/pdf): 24 passages, 1000/1200 chars indexed, text cut by this call\u2019s character budget',
    )
    // A source with no reported counts still names what it gave.
    expect(capped).toContain('  - zotero://user/0/attachment/WXYZ6789: 3 passages')
    expect(capped).toContain(ATTACHMENT_UNINDEXED_NOTE)
    expect(capped).toContain(ATTACHMENT_LIMIT_NOTE)
    expect(capped).toContain(silentAttachmentsMessage(2, 4))

    // A count without its total is stated as unknown, never guessed.
    const partial = render({
      ref: 'zotero://user/0/attachment/SECD0001',
      attachments: [
        {
          ref: 'zotero://user/0/attachment/SECD0001',
          status: 'indexed',
          coverage: { indexedChars: 5, complete: false },
          passages: 1,
        },
      ],
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    } as never)
    expect(partial).toContain('1 passages, 5/? chars indexed')
  })

  it('announces omitted evidence and the fulltext attachment', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      evidence: [],
      truncated: true,
      sourcesSkipped: [],
    } as never)
    expect(text).toContain('Full text: zotero://user/0/attachment/WXYZ6789')
    expect(text).toContain(RETRIEVE_TRUNCATED_MESSAGE)
    expect(text).toContain(RETRIEVE_TRUNCATED_REMEDY)
    expect(text).toContain('(0 passages)')
  })
})
