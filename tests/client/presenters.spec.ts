/**
 * Pure tool-row presenters: the truth ladder, defensive meta validation,
 * and the degradation matrix — all deterministic over the frozen block.
 * @module tests/client/presenters
 */

import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  argsOf,
  boolField,
  displayRefOf,
  errorSummaryOf,
  evidenceCountOf,
  evidenceItemsOf,
  evidenceSourcesOf,
  evidenceTruncatedOf,
  interpolate,
  isRecord,
  metaOf,
  previewsOf,
  queryOf,
  rawInputOf,
  resultTextOf,
  resultTitleOf,
  rowStateOf,
  scopeFactOf,
  searchCountsOf,
  searchRowsOf,
  shortKeyOf,
  titleOf,
} from '../../src/client/presenters.ts'
import { running as blockRunning, settled as blockSettled } from './helpers/blocks.ts'

// The shared factories default to a neutral `{}` args; these specs read the
// pending/completed query string, so the attention query stays the default.
function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return blockRunning({ argsRaw: '{"query":"attention"}', ...overrides })
}

function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return blockSettled({
    call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
    ...overrides,
  })
}

describe('isRecord / metaOf', () => {
  it('accepts only plain objects', () => {
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('x')).toBe(false)
  })

  it('reads meta from settled blocks only, validating the object shape', () => {
    expect(metaOf(running())).toBeNull()
    expect(metaOf(settled())).toBeNull()
    expect(metaOf(settled({ meta: { count: 3 } }))).toEqual({ count: 3 })
    expect(metaOf(settled({ meta: 'junk' }))).toBeNull()
    expect(metaOf(settled({ meta: [1] }))).toBeNull()
  })

  it('reads boolean fields strictly', () => {
    expect(boolField({ on: true }, 'on')).toBe(true)
    expect(boolField({ on: false }, 'on')).toBe(false)
    expect(boolField({ on: 'yes' }, 'on')).toBeUndefined()
    expect(boolField({}, 'on')).toBeUndefined()
  })
})

describe('rowStateOf / errorSummaryOf', () => {
  it('derives the four lifecycle states from the frozen block', () => {
    expect(rowStateOf(running())).toBe('running')
    expect(rowStateOf(settled())).toBe('ok')
    expect(rowStateOf(settled({ isError: true, error: { name: 'Error', code: 'X' } }))).toBe(
      'error',
    )
    expect(
      rowStateOf(settled({ isError: true, error: { name: 'Interrupted', code: 'interrupted' } })),
    ).toBe('stopped')
  })

  it('summarizes failures with the first flattened line', () => {
    expect(errorSummaryOf(settled())).toBeNull()
    const failed = settled({
      isError: true,
      error: { name: 'Error', code: 'ZOTERO_NOT_RUNNING' },
      content: [{ type: 'text', text: 'first line\nsecond line' }],
    })
    expect(errorSummaryOf(failed)).toBe('first line')
  })

  it('returns no summary when the error row has no text to flatten', () => {
    expect(errorSummaryOf(settled({ isError: true }))).toBeNull()
  })
})

describe('titleOf / resultTitleOf / rawInputOf', () => {
  it('prefers the generic call-view title over the fallback', () => {
    const withView = running({
      callView: { card: 'generic', title: 'Search Zotero library', rawInput: 'attention' },
    })
    expect(titleOf(withView, 'fallback')).toBe('Search Zotero library')
    expect(titleOf(running(), 'fallback')).toBe('fallback')
    expect(rawInputOf(withView)).toBe('attention')
    expect(rawInputOf(running())).toBeUndefined()
  })

  it('surfaces a declared generic result title', () => {
    expect(resultTitleOf(settled())).toBeUndefined()
    expect(
      resultTitleOf(
        settled({ resultView: { card: 'generic', title: 'Zotero search: found 6 of 42 results' } }),
      ),
    ).toBe('Zotero search: found 6 of 42 results')
  })
})

describe('resultTextOf / argsOf', () => {
  it('flattens text blocks and falls back to the error identity', () => {
    expect(resultTextOf(running())).toBeNull()
    expect(
      resultTextOf(
        settled({
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        }),
      ),
    ).toBe('a\nb')
    expect(resultTextOf(settled({ isError: true, error: { name: 'Error', code: 'X' } }))).toBe(
      'Error: X',
    )
    expect(resultTextOf(settled())).toBeNull()
  })

  it('serializes non-text content blocks verbatim', () => {
    const code = { type: 'code', code: 'x' } as unknown as ContentBlock
    expect(resultTextOf(settled({ content: [{ type: 'text', text: 'a' }, code] }))).toBe(
      `a\n${JSON.stringify(code)}`,
    )
  })

  it('parses args from the settled call head and the running form', () => {
    expect(argsOf(running())).toEqual({ query: 'attention' })
    expect(argsOf(settled())).toEqual({ query: 'attention' })
    expect(argsOf(settled({ call: null }))).toBeNull()
    expect(argsOf(running({ argsRaw: 'not json' }))).toBeNull()
    expect(argsOf(running({ argsRaw: '[1,2]' }))).toBeNull()
    expect(argsOf(running({ argsRaw: '"str"' }))).toBeNull()
    expect(argsOf(running({ argsRaw: '' }))).toBeNull()
  })
})

describe('ref and query helpers', () => {
  it('extracts the 8-character key from zotero refs', () => {
    expect(shortKeyOf('zotero://user/0/item/ABCD1234')).toBe('ABCD1234')
    expect(shortKeyOf('zotero://user/0/annotation/WXYZ6789?server=sPMHtLD6HHBd')).toBe('WXYZ6789')
    expect(shortKeyOf('not a ref')).toBeNull()
  })

  it('displays refs as their key and keeps other inputs verbatim', () => {
    expect(displayRefOf('zotero://user/0/item/ABCD1234')).toBe('ABCD1234')
    expect(displayRefOf('plain text')).toBe('plain text')
    expect(displayRefOf(undefined)).toBe('')
  })

  it('reads the query and encodes the search scope', () => {
    expect(queryOf({ query: 'attention' })).toBe('attention')
    expect(queryOf({})).toBe('')
    expect(scopeFactOf({})).toBe('library:metadata')
    expect(scopeFactOf({ mode: 'everything' })).toBe('library:everything')
    expect(scopeFactOf({ scope: { kind: 'collection', refOrName: 'papers' } })).toBe(
      'collection:papers',
    )
    expect(scopeFactOf({ scope: { kind: 'savedSearch', refOrName: 'recent' } })).toBe(
      'savedSearch:recent',
    )
    expect(scopeFactOf({ scope: { kind: 'savedSearch', refOrName: '' } })).toBe('library:metadata')
  })
})

describe('search projection reads', () => {
  it('validates rows and counts, degrading on malformed records', () => {
    const meta = {
      displayed: 2,
      omitted: 1,
      items: [
        {
          ref: 'zotero://user/0/item/AAAAAAA1',
          title: 'A',
          creatorSummary: '',
          itemType: 'journalArticle',
        },
        {
          ref: 'zotero://user/0/item/AAAAAAA2',
          title: 'B',
          creatorSummary: 'X',
          year: 2020,
          itemType: 'conferencePaper',
        },
      ],
    }
    expect(searchRowsOf(meta)).toEqual([
      {
        ref: 'zotero://user/0/item/AAAAAAA1',
        title: 'A',
        creatorSummary: '',
        itemType: 'journalArticle',
      },
      {
        ref: 'zotero://user/0/item/AAAAAAA2',
        title: 'B',
        creatorSummary: 'X',
        year: 2020,
        itemType: 'conferencePaper',
      },
    ])
    expect(searchCountsOf(meta)).toEqual({ displayed: 2, omitted: 1 })
    expect(searchRowsOf({ items: 'junk' })).toBeNull()
    expect(searchRowsOf({ items: [{ ref: 1 }] })).toBeNull()
    expect(searchRowsOf({ items: [null] })).toBeNull()
    expect(searchCountsOf({})).toBeNull()
  })
})

describe('preview and evidence projection reads', () => {
  it('validates child previews with optional page labels', () => {
    const meta = {
      notesPreview: [{ ref: 'zotero://user/0/item/NOTE0001', preview: 'text' }],
    }
    expect(previewsOf(meta, 'notesPreview')).toEqual([
      { ref: 'zotero://user/0/item/NOTE0001', preview: 'text' },
    ])
    expect(previewsOf(meta, 'annotationsPreview')).toBeNull()
    expect(previewsOf({ notesPreview: [{}] }, 'notesPreview')).toBeNull()
    expect(previewsOf({ notesPreview: [null] }, 'notesPreview')).toBeNull()
  })

  it('validates evidence items, counts, sources, and the truncated flag', () => {
    const meta = {
      count: 2,
      truncated: true,
      sources: ['annotation', 'fulltext'],
      items: [
        {
          source: 'annotation',
          sourceRef: 'zotero://user/0/annotation/ANN000001',
          preview: 'x',
          previewTruncated: false,
          pageLabel: '7',
        },
        {
          source: 'fulltext',
          sourceRef: 'zotero://user/0/item/ABCDEFGH',
          preview: 'y',
          previewTruncated: true,
        },
      ],
    }
    expect(evidenceCountOf(meta)).toBe(2)
    expect(evidenceTruncatedOf(meta)).toBe(true)
    expect(evidenceSourcesOf(meta)).toEqual(['annotation', 'fulltext'])
    expect(evidenceSourcesOf({})).toEqual([])
    expect(evidenceItemsOf(meta)).toEqual([
      {
        source: 'annotation',
        sourceRef: 'zotero://user/0/annotation/ANN000001',
        preview: 'x',
        previewTruncated: false,
        pageLabel: '7',
      },
      {
        source: 'fulltext',
        sourceRef: 'zotero://user/0/item/ABCDEFGH',
        preview: 'y',
        previewTruncated: true,
      },
    ])
    expect(evidenceItemsOf({ items: 'junk' })).toBeNull()
    expect(evidenceItemsOf({ items: [null] })).toBeNull()
    expect(evidenceItemsOf({ items: [{ sourceRef: 'r', preview: 'p' }] })).toBeNull()
    expect(evidenceItemsOf({ items: [{ source: 's', preview: 'p' }] })).toBeNull()
    expect(evidenceItemsOf({ items: [{ source: 's', sourceRef: 'r' }] })).toBeNull()
    expect(evidenceCountOf({})).toBeNull()
  })
})

describe('interpolate', () => {
  it('substitutes known placeholders and keeps unknown ones verbatim', () => {
    expect(interpolate('{count} results · {missing}', { count: 4 })).toBe('4 results · {missing}')
  })
})
