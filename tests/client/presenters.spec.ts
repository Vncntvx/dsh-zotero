/**
 * Pure block readers shared by the Sources panel: the truth ladder,
 * defensive meta validation, and the degradation matrix: all deterministic
 * over the frozen block.
 * @module tests/client/presenters
 */

import type {
  StartedToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  argsViewOf,
  boolArg,
  boolField,
  callNameOf,
  errorSummaryOf,
  evidenceItemsOf,
  isRecord,
  joinNonEmpty,
  listArg,
  metaOf,
  numberArg,
  numberField,
  recordArg,
  resultTextOf,
  rowStateOf,
  shortKeyOf,
  stringField,
  textArg,
} from '../../src/client/presenters.ts'
import {
  preparing as blockPreparing,
  running as blockRunning,
  settled as blockSettled,
} from './helpers/blocks.ts'

function preparing() {
  return blockPreparing()
}

function running(overrides: Partial<StartedToolCall> = {}): StartedToolCall {
  return blockRunning(overrides)
}

function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return blockSettled(overrides)
}

describe('isRecord', () => {
  it('accepts plain objects and rejects everything else', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord(null)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord('x')).toBe(false)
    expect(isRecord(3)).toBe(false)
  })
})

describe('field readers', () => {
  it('reads strings, finite numbers, and booleans, ignoring the rest', () => {
    expect(stringField({ a: 'x' }, 'a')).toBe('x')
    expect(stringField({ a: 3 }, 'a')).toBeUndefined()
    expect(stringField({}, 'a')).toBeUndefined()
    expect(numberField({ a: 2 }, 'a')).toBe(2)
    expect(numberField({ a: Number.NaN }, 'a')).toBeUndefined()
    expect(numberField({ a: '2' }, 'a')).toBeUndefined()
    expect(boolField({ a: true }, 'a')).toBe(true)
    expect(boolField({ a: 'true' }, 'a')).toBeUndefined()
    expect(boolField({}, 'a')).toBeUndefined()
  })
})

describe('callNameOf', () => {
  it('names calls from both block forms', () => {
    expect(callNameOf(running())).toBe('zotero_search')
    expect(callNameOf(settled())).toBe('zotero_search')
    expect(callNameOf(settled({ call: null }))).toBeNull()
  })
})

describe('metaOf', () => {
  it('reads meta from settled blocks only, validating the object shape', () => {
    expect(metaOf(running())).toBeNull()
    expect(metaOf(settled())).toBeNull()
    expect(metaOf(settled({ meta: { count: 3 } }))).toEqual({ count: 3 })
    expect(metaOf(settled({ meta: 'junk' }))).toBeNull()
  })
})

describe('rowStateOf', () => {
  it('derives the state from the block structure alone', () => {
    expect(rowStateOf(running())).toBe('running')
    expect(rowStateOf(settled())).toBe('ok')
    expect(rowStateOf(settled({ isError: true, error: { name: 'E', code: 'X' } }))).toBe('error')
    expect(rowStateOf(settled({ isError: true, error: { name: 'E', code: 'interrupted' } }))).toBe(
      'stopped',
    )
  })
})

describe('resultTextOf', () => {
  it('joins text blocks, pretty-prints the rest, and matches the harness resultText', () => {
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
    expect(
      resultTextOf(
        settled({ content: [{ type: 'json', data: { x: 1 } } as unknown as ContentBlock] }),
      ),
    ).toBe(JSON.stringify({ type: 'json', data: { x: 1 } }, null, 2))
    expect(
      resultTextOf(settled({ content: [], isError: true, error: { name: 'E', code: 'X' } })),
    ).toBe('E: X')
    expect(resultTextOf(settled({ content: [] }))).toBe('')
    expect(resultTextOf(running())).toBeNull()
  })
})

describe('the lazy argument view facade', () => {
  it('reads a field from both dispatched and settled blocks', () => {
    expect(
      textArg(argsViewOf(settled({ call: { name: 'zotero_get', argsRaw: '{"ref":"x"}' } })), 'ref'),
    ).toBe('x')
    expect(textArg(argsViewOf(running({ argsRaw: '{"ref":"x"}' })), 'ref')).toBe('x')
  })

  it('answers undefined, never throws, for malformed, empty, and non-object payloads', () => {
    expect(
      textArg(argsViewOf(settled({ call: { name: 'zotero_get', argsRaw: '{' } })), 'ref'),
    ).toBeUndefined()
    expect(textArg(argsViewOf(settled({ call: null })), 'ref')).toBeUndefined()
    expect(textArg(argsViewOf(running({ argsRaw: '[1]' })), 'ref')).toBeUndefined()
  })

  it('reads a preparing view, which grows in place as fragments land', () => {
    // A preparing block's arguments are still streaming, so the view carries
    // what has arrived so far instead of nothing at all.
    expect(preparing()).toBeDefined()
    const view = argsViewOf(running({ argsRaw: '{"query":"quantum' }))
    expect(textArg(view, 'query')).toBe('quantum')
  })

  it('reads non-string fields only once they close, and never invents values', () => {
    const view = argsViewOf(
      running({
        argsRaw: '{"tags":["a",1],"offset":20,"includeTrashed":true,"scope":{"kind":"library"}}',
      }),
    )
    expect(listArg(view, 'tags')).toEqual(['a'])
    expect(numberArg(view, 'offset')).toBe(20)
    expect(boolArg(view, 'includeTrashed')).toBe(true)
    expect(recordArg(view, 'scope')).toEqual({ kind: 'library' })
    expect(listArg(view, 'absent')).toEqual([])
    expect(numberArg(view, 'absent')).toBe(0)
    expect(boolArg(view, 'absent')).toBe(false)
    expect(recordArg(view, 'absent')).toBeNull()
    expect(textArg(view, 'absent')).toBeUndefined()
  })

  it('keeps a negative or non-finite number out of a numeric read', () => {
    expect(numberArg(argsViewOf(running({ argsRaw: '{"offset":-1}' })), 'offset')).toBe(0)
    expect(numberArg(argsViewOf(running({ argsRaw: '{"offset":"20"}' })), 'offset')).toBe(0)
  })
})

describe('shortKeyOf', () => {
  it('extracts the object key of every zotero ref kind, personal and group, and rejects junk', () => {
    expect(shortKeyOf('zotero://user/0/item/ABCDEFGH')).toBe('ABCDEFGH')
    expect(shortKeyOf('zotero://user/0/attachment/WXYZ6789?server=S1')).toBe('WXYZ6789')
    expect(shortKeyOf('zotero://user/0/annotation/ANN00001')).toBe('ANN00001')
    expect(shortKeyOf('zotero://user/0/collection/COLLECT1')).toBe('COLLECT1')
    expect(shortKeyOf('zotero://user/0/search/SEARCH01')).toBe('SEARCH01')
    // Group-library refs share the grammar the host parser serves; a
    // client-side copy pinned to user/0 would drop them.
    expect(shortKeyOf('zotero://group/1234/item/GROUPKEY')).toBe('GROUPKEY')
    expect(shortKeyOf('zotero://group/12/attachment/ATTACH01?server=S1')).toBe('ATTACH01')
    expect(shortKeyOf('junk')).toBeNull()
  })
})

describe('evidenceItemsOf', () => {
  it('decodes valid passages with their optional page labels', () => {
    expect(
      evidenceItemsOf({
        items: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN1',
            preview: 'a',
            pageLabel: '7',
          },
          {
            source: 'fulltext',
            sourceRef: 'zotero://user/0/item/ABCDEFGH',
            preview: 'b',
            previewTruncated: true,
          },
        ],
      }),
    ).toEqual([
      {
        source: 'annotation',
        sourceRef: 'zotero://user/0/annotation/ANN1',
        preview: 'a',
        previewTruncated: false,
        pageLabel: '7',
      },
      {
        source: 'fulltext',
        sourceRef: 'zotero://user/0/item/ABCDEFGH',
        preview: 'b',
        previewTruncated: true,
      },
    ])
  })

  it('degrades malformed records to null', () => {
    expect(evidenceItemsOf({ items: 'x' })).toBeNull()
    expect(evidenceItemsOf({ items: [{ source: 'annotation' }] })).toBeNull()
    expect(evidenceItemsOf({ items: ['x'] })).toBeNull()
  })

  it('rejects an unknown source instead of mislabeling its provenance', () => {
    // A blind cast would pass the string through to the labels, which would
    // read it as full text; the vocabulary is closed, so the meta is malformed.
    expect(
      evidenceItemsOf({
        items: [
          {
            source: 'citation-graph',
            sourceRef: 'zotero://user/0/item/ABCDEFGH',
            preview: 'a',
          },
        ],
      }),
    ).toBeNull()
  })
})

describe('joinNonEmpty', () => {
  it('joins the non-empty parts with the middot separator', () => {
    expect(joinNonEmpty('Dao', 2023, '', undefined, 'ICLR')).toBe('Dao · 2023 · ICLR')
    expect(joinNonEmpty()).toBe('')
  })
})

describe('errorSummaryOf', () => {
  it('returns null when block is not in error state', () => {
    expect(errorSummaryOf(settled({ isError: false }))).toBeNull()
    expect(errorSummaryOf(running())).toBeNull()
  })

  it('extracts first line from settled error block or returns null', () => {
    const blockWithText = settled({
      isError: true,
      content: [{ type: 'text', text: 'First error line\nSecond line' }],
    })
    expect(errorSummaryOf(blockWithText)).toBe('First error line')
    expect(errorSummaryOf(blockWithText, 'Precomputed raw line\nsecond')).toBe(
      'Precomputed raw line',
    )

    const blockEmpty = settled({
      isError: true,
      content: [],
    })
    expect(errorSummaryOf(blockEmpty)).toBeNull()
  })
})
