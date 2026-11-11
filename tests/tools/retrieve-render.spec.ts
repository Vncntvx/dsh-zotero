/**
 * The `zotero_retrieve` evidence renderer: coverage, locators, skipped
 * sources, cut flags, and honest empty-answer wording.
 * @module tests/tools/retrieve-render
 */

import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_LIMIT_NOTE,
  ATTACHMENT_UNINDEXED_NOTE,
  NO_CONTENT_TERMS_MESSAGE,
  NO_MATCH_MESSAGE,
  NO_MATCH_REMEDY,
  NO_MATCH_TERMS_ONLY_MESSAGE,
  NO_SOURCES_MESSAGE,
  NO_SOURCES_REMEDY,
  PASSAGE_COMMENT_ONLY_CLAUSE,
  renderRetrieve,
  RETRIEVE_TRUNCATED_MESSAGE,
  RETRIEVE_TRUNCATED_REMEDY,
  SEMANTIC_ONLY_NOTE,
  silentAttachmentsMessage,
} from '../../src/tools/retrieve.js'

describe('zotero_retrieve render', () => {
  /** One evidence entry as a render test writes it: the match kind defaults. */
  type RenderEvidence = {
    source: string
    sourceRef: string
    text: string
    matchKind?: string
    [key: string]: unknown
  }
  /** The render input, with the schema's required arrays and kind defaulted. */
  type RenderValue = {
    ref: string
    evidence: RenderEvidence[]
    truncated: boolean
    sourcesSkipped: string[]
    queryTerms?: string[]
    [key: string]: unknown
  }

  /**
   * Render one result. The wire requires `matchKind` and `queryTerms`; a test
   * that is not exercising them leaves them out, and this fills the values a
   * lexical-only ranking produces so each case asserts one thing.
   */
  function render(value: RenderValue): string {
    const filled = {
      ...value,
      queryTerms: value.queryTerms ?? [],
      evidence: value.evidence.map((entry) => ({ matchKind: 'lexical', ...entry })),
    }
    return (renderRetrieve({} as never, filled as never)[0] as { text: string }).text
  }

  it('renders a minimal single abstract passage', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        { source: 'abstract', sourceRef: 'zotero://user/0/item/ABCD1234', text: 'abstract text' },
      ],
      truncated: false,
      sourcesSkipped: [],
    })
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
    })
    expect(charsOnly).toContain('Indexing coverage: 10/12 chars')

    const pagesOnly = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedPages: 2, totalPages: 9, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    })
    expect(pagesOnly).toContain('Indexing coverage: , 2/9 pages')

    const unknownTotals = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 5, indexedPages: 3, complete: false },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    })
    expect(unknownTotals).toContain('Indexing coverage: 5/? chars, 3/? pages')

    const complete = render({
      ref: 'zotero://user/0/item/ABCD1234',
      coverage: { indexedChars: 5, totalChars: 5, complete: true },
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
    })
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
    })
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
    })
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
    })
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
    })
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
    })
    expect(partial).toContain('1 passages, 5/? chars indexed')
  })

  it('announces omitted evidence and the fulltext attachment', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      attachmentRef: 'zotero://user/0/attachment/WXYZ6789',
      evidence: [],
      truncated: true,
      sourcesSkipped: [],
    })
    expect(text).toContain('Full text: zotero://user/0/attachment/WXYZ6789')
    expect(text).toContain(RETRIEVE_TRUNCATED_MESSAGE)
    expect(text).toContain(RETRIEVE_TRUNCATED_REMEDY)
    expect(text).toContain('(0 passages)')
  })

  it('states what an empty match does and does not mean', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
      queryTerms: ['trust', 'compliance'],
      rankedRoutes: ['lexical', 'semantic'],
      noMatch: 'no-overlap',
    })
    expect(text).toContain(NO_MATCH_MESSAGE)
    expect(text).toContain(NO_MATCH_REMEDY)
    expect(text).not.toContain(NO_CONTENT_TERMS_MESSAGE)
    // An empty answer is not the truncation case: nothing was omitted.
    expect(text).not.toContain(RETRIEVE_TRUNCATED_MESSAGE)
  })

  it('never claims a meaning comparison the call did not make', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
      queryTerms: ['trust', 'compliance'],
      rankedRoutes: ['lexical'],
      noMatch: 'no-overlap',
    })
    expect(text).toContain(NO_MATCH_TERMS_ONLY_MESSAGE)
    expect(text).not.toContain(NO_MATCH_MESSAGE)
  })

  it('does not claim a no-match when the budget omitted every passage', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: true,
      sourcesSkipped: [],
      queryTerms: ['trust'],
      rankedRoutes: ['lexical', 'semantic'],
    })
    expect(text).toContain(RETRIEVE_TRUNCATED_MESSAGE)
    expect(text).toContain(RETRIEVE_TRUNCATED_REMEDY)
    expect(text).not.toContain(NO_MATCH_MESSAGE)
    expect(text).not.toContain(NO_MATCH_TERMS_ONLY_MESSAGE)
    expect(text).not.toContain(NO_SOURCES_MESSAGE)
  })

  it('does not claim a no-match when no cause was recorded', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
      queryTerms: ['trust'],
      rankedRoutes: ['lexical', 'semantic'],
    })
    expect(text).not.toContain(NO_MATCH_MESSAGE)
    expect(text).not.toContain(NO_MATCH_TERMS_ONLY_MESSAGE)
  })

  it('reports an empty corpus as no-sources, not as a tested overlap', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: false,
      sourcesSkipped: ['annotation', 'fulltext'],
      queryTerms: ['trust'],
      noMatch: 'no-sources',
    })
    expect(text).toContain(NO_SOURCES_MESSAGE)
    expect(text).toContain(NO_SOURCES_REMEDY)
    expect(text).not.toContain(NO_MATCH_MESSAGE)
    expect(text).not.toContain(NO_MATCH_TERMS_ONLY_MESSAGE)
  })

  it('explains a termless lexical-only empty match', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
      queryTerms: [],
      rankedRoutes: ['lexical'],
      noMatch: 'no-overlap',
    })
    expect(text).toContain(NO_CONTENT_TERMS_MESSAGE)
    expect(text).not.toContain(NO_MATCH_REMEDY)
  })

  it('does not misexplain a termless semantic empty match as a wording failure', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [],
      truncated: false,
      sourcesSkipped: [],
      queryTerms: [],
      rankedRoutes: ['lexical', 'semantic'],
      noMatch: 'no-overlap',
    })
    expect(text).not.toContain(NO_CONTENT_TERMS_MESSAGE)
    expect(text).toContain(NO_MATCH_REMEDY)
  })

  it('names a meaning-only hit and refuses to let it be quoted as wording', () => {
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        {
          source: 'fulltext',
          sourceRef: 'zotero://user/0/attachment/WXYZ6789',
          text: 'perceived legitimacy drives regulatory adherence',
          matchKind: 'semantic',
        },
      ],
      truncated: false,
      sourcesSkipped: [],
    })
    expect(text).toContain('[fulltext, meaning only] zotero://user/0/attachment/WXYZ6789')
    expect(text).toContain(SEMANTIC_ONLY_NOTE)
  })

  it('leaves the ordinary lexical hit unlabelled', () => {
    // The passage's own words carry the query, so the ordinary case renders
    // without a label.
    const text = render({
      ref: 'zotero://user/0/item/ABCD1234',
      evidence: [
        { source: 'fulltext', sourceRef: 'zotero://user/0/attachment/WXYZ6789', text: 'trust' },
      ],
      truncated: false,
      sourcesSkipped: [],
    })
    expect(text).toContain('[fulltext] zotero://user/0/attachment/WXYZ6789')
    expect(text).not.toContain(SEMANTIC_ONLY_NOTE)
  })
})
