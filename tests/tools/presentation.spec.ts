/**
 * The tools' model-facing presentation: the pending card every tool declares,
 * the search page projection, the completed-card titles through the
 * `it.each` table, and the generic-card fallback for metadata the tools do
 * not recognize.
 * @module tests/tools/presentation
 */

import { type ToolDefinition, type ToolResult } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type HostLane, setupHostLane } from '../helpers/lanes/host-lane.js'

let lane: HostLane

beforeEach(async () => {
  lane = await setupHostLane()
})

afterEach(async () => {
  await lane.teardown()
})

describe('tool presentation', () => {
  function definition(name: string): ToolDefinition {
    const tool = lane.tool(name)
    if (tool === undefined) throw new Error(`tool ${name} not registered`)
    return tool
  }

  it('declares a pending card for every tool', () => {
    expect(
      definition('zotero_search').presentCall!({ query: 'attention', scope: { kind: 'library' } }),
    ).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'Search Zotero library',
      rawInput: 'attention',
    })
    expect(definition('zotero_search').presentCall!({})).toMatchObject({ rawInput: '(browse)' })
    expect(definition('zotero_get').presentCall!({ ref: 'zotero://user/0/item/ABCD1234' })).toEqual(
      {
        card: 'generic',
        kind: 'read',
        title: 'Read Zotero item',
        rawInput: 'zotero://user/0/item/ABCD1234',
      },
    )
    expect(
      definition('zotero_attachment').presentCall!({ ref: 'zotero://user/0/attachment/WXYZ6789' }),
    ).toEqual({
      card: 'generic',
      kind: 'read',
      title: 'Resolve Zotero attachment',
      rawInput: 'zotero://user/0/attachment/WXYZ6789',
    })
    expect(
      definition('zotero_children').presentCall!({ ref: 'zotero://user/0/item/ABCD1234' }),
    ).toEqual({
      card: 'generic',
      kind: 'read',
      title: 'Read Zotero children',
      rawInput: 'zotero://user/0/item/ABCD1234',
    })
    expect(definition('zotero_children').isConcurrencySafe?.({})).toBe(false)
    expect(
      definition('zotero_children').isConcurrencySafe?.({ ref: 'zotero://user/0/item/ABCD1234' }),
    ).toBe(true)
    expect(
      definition('zotero_retrieve').presentCall!({
        ref: 'zotero://user/0/item/ABCD1234',
        query: 'tiling',
      }),
    ).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'Retrieve Zotero evidence',
      rawInput: 'tiling',
    })
    expect(
      definition('zotero_export').presentCall!({
        refs: ['zotero://user/0/item/ABCD1234'],
        format: 'bibliography',
      }),
    ).toEqual({
      card: 'generic',
      title: 'Export Zotero citations',
      rawInput: '1 refs · bibliography',
    })
    expect(definition('zotero_browse').presentCall!({ kind: 'collections' })).toEqual({
      card: 'generic',
      kind: 'search',
      title: 'Browse Zotero collections',
      rawInput: 'collections',
    })
    expect(definition('zotero_browse').isConcurrencySafe?.({ kind: 'tags' })).toBe(true)
    expect(definition('zotero_changes').presentCall!({})).toEqual({
      card: 'generic',
      kind: 'read',
      title: 'Read Zotero changes',
      rawInput: 'baseline',
    })
    const cursor = { serverId: 'S1', library: { type: 'user', id: 0 }, version: 42 }
    expect(definition('zotero_changes').presentCall!({ since: cursor })).toMatchObject({
      rawInput: '42',
    })
    expect(definition('zotero_changes').isConcurrencySafe?.({ since: cursor })).toBe(true)
  })

  it('projects replayable search page facts and renders the completed card', () => {
    const tool = definition('zotero_search')
    const value = {
      scope: { kind: 'library' as const, library: { type: 'user' as const, id: 0 as const } },
      items: [],
      total: 42,
      offset: 0,
      returned: 10,
      nextOffset: 10,
    }
    expect(tool.output.presentationMeta!({}, value)).toEqual({
      returned: 10,
      total: 42,
      nextOffset: 10,
      displayed: 0,
      omitted: 10,
      noteMatches: null,
      items: [],
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      library: { type: 'user', id: 0 },
    })
    // A final page omits nextOffset; the projector records it as null so the
    // projection stays lossless JSON.
    expect(
      tool.output.presentationMeta!(
        {},
        {
          scope: { kind: 'library', library: { type: 'user', id: 0 } },
          items: [],
          total: 42,
          offset: 0,
          returned: 10,
        },
      ),
    ).toEqual({
      returned: 10,
      total: 42,
      nextOffset: null,
      displayed: 0,
      omitted: 10,
      noteMatches: null,
      items: [],
      scope: { kind: 'library', library: { type: 'user', id: 0 } },
      library: { type: 'user', id: 0 },
    })
    const result: ToolResult = {
      content: [{ type: 'text', text: 'x' }],
      isError: false,
      meta: { returned: 10, total: 42, nextOffset: null },
    }
    expect(tool.presentResult!({}, result)).toEqual({
      card: 'generic',
      title: 'Zotero search: found 10 of 42 results',
    })
    const withNotes: ToolResult = {
      content: [{ type: 'text', text: 'x' }],
      isError: false,
      meta: { returned: 10, total: 42, nextOffset: null, noteMatches: 3 },
    }
    expect(tool.presentResult!({}, withNotes)).toEqual({
      card: 'generic',
      title: 'Zotero search: found 10 of 42 results (+3 note matches)',
    })
  })

  it.each([
    [
      'zotero_get',
      { ref: 'zotero://user/0/item/ABCD1234' },
      { title: 'FlashAttention-2', year: 2023 },
      'Zotero item: FlashAttention-2 (2023)',
    ],
    [
      'zotero_get',
      { ref: 'zotero://user/0/item/ABCD1234' },
      { title: 'Paper' },
      'Zotero item: Paper',
    ],
    [
      'zotero_children',
      { ref: 'zotero://user/0/item/ABCD1234' },
      { notes: { total: 2, returned: 2 }, attachments: { total: 1, returned: 1 } },
      'Zotero children: 2 notes, 1 attachments',
    ],
    [
      'zotero_attachment',
      { ref: 'zotero://user/0/item/ABCD1234' },
      { title: 'paper.pdf', kind: 'file' },
      'Zotero attachment: paper.pdf (file)',
    ],
    [
      'zotero_retrieve',
      { ref: 'zotero://user/0/item/ABCD1234', query: 'tiling' },
      { count: 4, truncated: true },
      'Zotero evidence: 4 passages (truncated)',
    ],
    [
      'zotero_export',
      { refs: ['zotero://user/0/item/ABCD1234'], format: 'citation' },
      { format: 'citation', count: 2 },
      'Zotero export: 2 citations',
    ],
    [
      'zotero_export',
      { refs: ['zotero://user/0/item/ABCD1234'], format: 'bibtex' },
      { format: 'bibtex', requested: 3 },
      'Zotero export: 3 refs as bibtex',
    ],
    [
      'zotero_browse',
      { kind: 'tags' },
      { kind: 'tags', returned: 5, total: 20 },
      'Zotero browse: tags (5 of 20)',
    ],
    [
      'zotero_changes',
      {},
      { changed: { items: [{ key: 'A', version: 2 }] }, deleted: { items: [] } },
      'Zotero changes: 1 changed or deleted',
    ],
    [
      'zotero_changes',
      {},
      { cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 7 } },
      'Zotero changes: baseline at version 7',
    ],
    [
      'zotero_changes',
      {},
      {
        fromVersion: 3,
        cursor: { serverId: 'S1', library: { type: 'user', id: 0 }, version: 7 },
      },
      'Zotero changes: 3 → 7',
    ],
    [
      'zotero_changes',
      {},
      { changed: { items: [] }, totals: { items: 120, deletedItems: 4 } },
      'Zotero changes: 124 changed or deleted',
    ],
    [
      'zotero_changes',
      {},
      { changed: { items: [] }, totals: { items: 3, bogus: 'x' } },
      'Zotero changes: 3 changed or deleted',
    ],
    // A record without totals (a replay) counts its rows, tolerating a section
    // that is missing or carries something that is not a row array.
    [
      'zotero_changes',
      {},
      { changed: { items: [{ key: 'A', version: 2 }], junk: 'x' } },
      'Zotero changes: 1 changed or deleted',
    ],
  ])('renders a completed card for %s', (name, args, meta, title) => {
    const result: ToolResult = {
      content: [{ type: 'text', text: 'x' }],
      isError: false,
      meta: meta as ToolResult['meta'],
    }
    expect(definition(name).presentResult!(args, result)).toEqual({ card: 'generic', title })
  })

  it('falls back to the generic card for the other tools on bad metadata', () => {
    const err = (meta: unknown): ToolResult => ({
      content: [{ type: 'text', text: 'Error: x' }],
      isError: true,
      ...(meta === undefined ? {} : { meta: meta as ToolResult['meta'] }),
    })
    const ok = (meta: unknown): ToolResult => ({
      content: [{ type: 'text', text: 'x' }],
      isError: false,
      ...(meta === undefined ? {} : { meta: meta as ToolResult['meta'] }),
    })
    const argsFor: Record<string, Record<string, unknown>> = {
      zotero_get: { ref: 'zotero://user/0/item/ABCD1234' },
      zotero_children: { ref: 'zotero://user/0/item/ABCD1234' },
      zotero_attachment: { ref: 'zotero://user/0/item/ABCD1234' },
      zotero_retrieve: { ref: 'zotero://user/0/item/ABCD1234', query: 'tiling' },
      zotero_export: { refs: ['zotero://user/0/item/ABCD1234'], format: 'citation' },
      zotero_browse: { kind: 'tags' },
      zotero_changes: {},
    }
    for (const name of Object.keys(argsFor)) {
      const tool = definition(name)
      const args = argsFor[name]
      expect(tool.presentResult).toBeDefined()
      expect(tool.presentResult!(args, err({}))).toBeUndefined()
      expect(tool.presentResult!(args, ok(undefined))).toBeUndefined()
      expect(tool.presentResult!(args, ok('junk'))).toBeUndefined()
      expect(tool.presentResult!(args, ok([]))).toBeUndefined()
    }
    const getArgs = argsFor.zotero_get
    expect(definition('zotero_get').presentResult!(getArgs, ok({}))).toBeUndefined()
    expect(definition('zotero_get').presentResult!(getArgs, ok({ title: '' }))).toBeUndefined()
    const childrenArgs = argsFor.zotero_children
    expect(definition('zotero_children').presentResult!(childrenArgs, ok({}))).toBeUndefined()
    expect(
      definition('zotero_children').presentResult!(childrenArgs, ok({ notes: { total: 'x' } })),
    ).toBeUndefined()
    expect(
      definition('zotero_children').presentResult!(childrenArgs, ok({ notes: 'x' })),
    ).toBeUndefined()
    const attachmentArgs = argsFor.zotero_attachment
    expect(
      definition('zotero_attachment').presentResult!(
        attachmentArgs,
        ok({ title: 'a', kind: 'other' }),
      ),
    ).toBeUndefined()
    expect(
      definition('zotero_attachment').presentResult!(attachmentArgs, ok({ kind: 'file' })),
    ).toBeUndefined()
    const retrieveArgs = argsFor.zotero_retrieve
    expect(definition('zotero_retrieve').presentResult!(retrieveArgs, ok({}))).toBeUndefined()
    expect(definition('zotero_retrieve').presentResult!(retrieveArgs, ok({ count: 2 }))).toEqual({
      card: 'generic',
      title: 'Zotero evidence: 2 passages',
    })
    const exportArgs = argsFor.zotero_export
    expect(definition('zotero_export').presentResult!(exportArgs, ok({}))).toBeUndefined()
    expect(
      definition('zotero_export').presentResult!(exportArgs, ok({ format: 'citation' })),
    ).toBeUndefined()
    expect(
      definition('zotero_export').presentResult!(exportArgs, ok({ format: '', requested: 1 })),
    ).toBeUndefined()
    expect(
      definition('zotero_export').presentResult!(exportArgs, ok({ format: 'ris' })),
    ).toBeUndefined()
    const browseArgs = argsFor.zotero_browse
    expect(definition('zotero_browse').presentResult!(browseArgs, ok({}))).toBeUndefined()
    expect(
      definition('zotero_browse').presentResult!(browseArgs, ok({ kind: 'tags', returned: 1 })),
    ).toBeUndefined()
    const changesArgs = argsFor.zotero_changes
    expect(definition('zotero_changes').presentResult!(changesArgs, ok({}))).toBeUndefined()
  })
})

describe('receipt text flattening', () => {
  it('keeps only the text blocks when flattening a receipt', async () => {
    const { textOfBlocks } = await import('../../src/tools/present.js')
    // A job outcome stores plain text: a non-text block leaves an empty slot
    // in the join instead of leaking its payload into the receipt.
    expect(
      textOfBlocks([
        { type: 'text', text: 'line one' },
        { type: 'reasoning', text: 'hidden reasoning' },
        { type: 'text', text: 'line two' },
      ]),
    ).toBe('line one\n\nline two')
    expect(textOfBlocks([{ type: 'reasoning', text: 'only reasoning' }])).toBe('')
  })
})
