/**
 * Pure block readers shared by the Sources panel: the truth ladder,
 * defensive meta validation, and the degradation matrix — all deterministic
 * over the frozen block.
 * @module tests/client/presenters
 */

import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  argsOf,
  boolField,
  callNameOf,
  evidenceItemsOf,
  interpolate,
  isRecord,
  joinNonEmpty,
  metaOf,
  numberField,
  orderKeyOf,
  resultTextOf,
  rowStateOf,
  shortKeyOf,
  stringField,
} from '../../src/client/presenters.ts'
import { running as blockRunning, settled as blockSettled } from './helpers/blocks.ts'

function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
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

describe('callNameOf / orderKeyOf', () => {
  it('names calls from both block forms and orders them stably', () => {
    expect(callNameOf(running())).toBe('zotero_search')
    expect(callNameOf(settled())).toBe('zotero_search')
    expect(callNameOf(settled({ call: null }))).toBeNull()
    expect(orderKeyOf(settled({ seq: 2 }))).toBe(2)
    expect(orderKeyOf(running({ time: 5 }))).toBe(1_000_000_005)
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
  it('joins text blocks, stringifies the rest, and degrades to null', () => {
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
    ).toBe('{"type":"json","data":{"x":1}}')
    expect(
      resultTextOf(settled({ content: [], isError: true, error: { name: 'E', code: 'X' } })),
    ).toBe('E: X')
    expect(resultTextOf(settled({ content: [] }))).toBeNull()
    expect(resultTextOf(running())).toBeNull()
  })
})

describe('argsOf', () => {
  it('parses the frozen args string from both block forms, degrading to null', () => {
    expect(argsOf(settled({ call: { name: 'zotero_get', argsRaw: '{"ref":"x"}' } }))).toEqual({
      ref: 'x',
    })
    expect(argsOf(running({ argsRaw: '{"ref":"x"}' }))).toEqual({ ref: 'x' })
    expect(argsOf(settled({ call: { name: 'zotero_get', argsRaw: '{' } }))).toBeNull()
    expect(argsOf(settled({ call: null }))).toBeNull()
    expect(argsOf(running({ argsRaw: '[1]' }))).toBeNull()
  })
})

describe('shortKeyOf', () => {
  it('extracts the object key of every zotero ref kind and rejects junk', () => {
    expect(shortKeyOf('zotero://user/0/item/ABCDEFGH')).toBe('ABCDEFGH')
    expect(shortKeyOf('zotero://user/0/attachment/WXYZ6789?server=S1')).toBe('WXYZ6789')
    expect(shortKeyOf('zotero://user/0/annotation/ANN00001')).toBe('ANN00001')
    expect(shortKeyOf('zotero://user/0/collection/COLLECT1')).toBe('COLLECT1')
    expect(shortKeyOf('zotero://user/0/search/SEARCH01')).toBe('SEARCH01')
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
})

describe('interpolate', () => {
  it('substitutes known placeholders and keeps unknown ones verbatim', () => {
    expect(interpolate('{count} results · {missing}', { count: 4 })).toBe('4 results · {missing}')
  })
})

describe('joinNonEmpty', () => {
  it('joins the non-empty parts with the middot separator', () => {
    expect(joinNonEmpty('Dao', 2023, '', undefined, 'ICLR')).toBe('Dao · 2023 · ICLR')
    expect(joinNonEmpty()).toBe('')
  })
})
