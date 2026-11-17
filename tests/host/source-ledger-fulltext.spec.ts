import { createSourceLedgerProjection } from '../../src/session-projection/source-ledger.ts'
import { workspaceOf } from './support/source-ledger-view.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
/**
 * A `mode:"fulltext"` retrieve settles as its own literature-trail fact: the
 * trail records that a complete document was read in windows, without treating
 * the windows as ranked evidence. The workspace wire schema must accept it.
 * @module tests/host/source-ledger-fulltext
 */

import { describe, expect, it } from 'vitest'
import {
  emptyLedgerState,
  foldLedgerEvent,
  type SourceLedgerState,
} from '../../src/sources/event-ledger.js'
import { sourceWorkspaceSchema } from '../../src/sources/workspace-schema.js'
import { projectRetrieveMeta } from '../../src/presentation-meta.js'
import type { ZoteroFulltextRead, ZoteroRetrieveResult } from '../../src/types.js'
import { fulltextHit } from '../helpers/retrieve-fixtures.js'
import { createEventFactory } from './support/source-ledger-events.js'

const event = createEventFactory()

function fold(events: readonly SessionEvent[]): SourceLedgerState {
  return events.reduce((state, entry) => foldLedgerEvent(state, entry), emptyLedgerState())
}

const REF = 'zotero://user/0/attachment/EFGH5678'

function fulltextResult(overrides: Partial<ZoteroFulltextRead> = {}): ZoteroRetrieveResult {
  return {
    mode: 'fulltext',
    fulltext: {
      sourceKind: 'attachment',
      sourceLabel: REF,
      textFormat: 'markdown',
      totalChars: 40_000,
      inputTruncated: false,
      start: 0,
      end: 12_000,
      text: 'x'.repeat(12_000),
      isTruncated: true,
      nextStart: 12_000,
      attachmentRef: REF,
      ...overrides,
    },
  }
}

/** Settle one fulltext retrieve exactly as the session event stream does. */
function fulltextState(meta: Record<string, unknown>): SourceLedgerState {
  return fold([
    event('tool/call', {
      callId: 'fulltext-read',
      name: 'zotero_retrieve',
      arguments: JSON.stringify({ mode: 'fulltext', source: { kind: 'ref', ref: REF }, start: 0 }),
    }),
    event('tool/result', {
      message: { toolCallId: 'fulltext-read', content: [] },
      meta,
    }),
  ])
}

describe('fulltext reads in the literature trail', () => {
  it('folds one fulltext window as a fulltextRead fact, not an evidence passage', () => {
    const meta = projectRetrieveMeta(fulltextResult(), [
      'annotation',
      'note',
      'abstract',
      'fulltext',
    ])
    const workspace = workspaceOf(fulltextState(meta as unknown as Record<string, unknown>))
    expect(workspace.sources).toHaveLength(1)
    const source = workspace.sources[0]!
    expect(source.evidence).toEqual([])
    expect(source.fulltextReads).toHaveLength(1)
    expect(source.fulltextReads[0]).toMatchObject({
      sourceKind: 'attachment',
      sourceLabel: REF,
      textFormat: 'markdown',
      totalChars: 40_000,
      start: 0,
      end: 12_000,
      isTruncated: true,
      callIds: ['fulltext-read'],
    })
    expect(source.facts.reportedEvidenceCount).toBe(0)
    // The mode is decoupled from the evidence side: no availability facts, no
    // budget flag, and no evidence-retrieve run count.
    expect(source.retrievalFacts).toBeUndefined()
    expect(source.retrievalSummary).toBeUndefined()
  })

  it('keeps an artifactId read addressable by its opaque handle', () => {
    const artifactId = 'a'.repeat(64)
    const state = fold([
      event('tool/call', {
        callId: 'artifact-read',
        name: 'zotero_retrieve',
        arguments: JSON.stringify({
          mode: 'fulltext',
          source: { kind: 'artifactId', artifactId },
          start: 0,
        }),
      }),
      event('tool/result', {
        message: { toolCallId: 'artifact-read', content: [] },
        meta: projectRetrieveMeta(
          fulltextResult({
            sourceKind: 'url',
            sourceLabel: 'https://example.org',
            attachmentRef: undefined,
          }),
          ['annotation', 'note', 'abstract', 'fulltext'],
        ),
      }),
    ])
    const workspace = workspaceOf(state)
    expect(workspace.sources[0]!.ref).toBe(`artifact:${artifactId}`)
    // The row's title is the window's safe source label, not the hex id.
    expect(workspace.sources[0]!.title).toBe('https://example.org')
    expect(workspace.sources[0]!.fulltextReads).toHaveLength(1)
    expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(true)
  })

  it('keeps the workspace wire view valid for a fulltext-only item', () => {
    const meta = projectRetrieveMeta(fulltextResult(), [
      'annotation',
      'note',
      'abstract',
      'fulltext',
    ])
    const parsed = sourceWorkspaceSchema.safeParse(
      workspaceOf(fulltextState(meta as unknown as Record<string, unknown>)),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw parsed.error
    expect(parsed.data.sources[0]!.fulltextReads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ start: 0, end: 12_000, callIds: ['fulltext-read'] }),
      ]),
    )
  })

  it('merges repeated identical windows under one fact with both call ids', () => {
    const meta = projectRetrieveMeta(fulltextResult(), [
      'annotation',
      'note',
      'abstract',
      'fulltext',
    ]) as unknown as Record<string, unknown>
    const state = [
      event('tool/call', {
        callId: 'w1',
        name: 'zotero_retrieve',
        arguments: JSON.stringify({ mode: 'fulltext', source: { kind: 'ref', ref: REF } }),
      }),
      event('tool/result', { message: { toolCallId: 'w1', content: [] }, meta }),
      event('tool/call', {
        callId: 'w2',
        name: 'zotero_retrieve',
        arguments: JSON.stringify({ mode: 'fulltext', source: { kind: 'ref', ref: REF } }),
      }),
      event('tool/result', { message: { toolCallId: 'w2', content: [] }, meta }),
    ]
    const workspace = workspaceOf(fold(state))
    expect(workspace.sources[0]!.fulltextReads).toHaveLength(1)
    expect(workspace.sources[0]!.fulltextReads[0]!.callIds).toEqual(['w1', 'w2'])
  })

  it.each([
    {
      name: 'reversed offsets',
      changes: { start: 12_000, end: 1 },
      issue: 'at or after its start',
    },
    {
      name: 'artifact on plain text',
      changes: { textFormat: 'text', artifact: fulltextHit('text', REF).provenance },
      issue: 'identifies Markdown',
    },
    { name: 'unknown fields', changes: { unsupported: true }, issue: 'Unrecognized key' },
  ])('refuses $name at the fulltext wire boundary', ({ changes, issue }) => {
    const meta = projectRetrieveMeta(fulltextResult(), [
      'annotation',
      'note',
      'abstract',
      'fulltext',
    ])
    const workspace = workspaceOf(fulltextState(meta as unknown as Record<string, unknown>))
    const source = workspace.sources[0]!
    const result = sourceWorkspaceSchema.safeParse({
      ...workspace,
      sources: [{ ...source, fulltextReads: [{ ...source.fulltextReads[0], ...changes }] }],
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Invalid fulltext fact passed the wire boundary')
    expect(result.error.issues.map((entry) => entry.message).join(' ')).toContain(issue)
  })

  it('does not fold a malformed fulltextRead fact', () => {
    const meta = {
      ...projectRetrieveMeta(fulltextResult(), ['annotation', 'note', 'abstract', 'fulltext']),
      fulltextRead: { nope: true },
    }
    const workspace = workspaceOf(fulltextState(meta as unknown as Record<string, unknown>))
    expect(workspace.sources[0]!.fulltextReads).toEqual([])
  })

  it('records a second fact for a differently bounded window', () => {
    const sources = ['annotation', 'note', 'abstract', 'fulltext'] as const
    const first = projectRetrieveMeta(fulltextResult(), sources) as unknown as Record<
      string,
      unknown
    >
    const second = projectRetrieveMeta(
      fulltextResult({ start: 12_000, end: 24_000, nextStart: 24_000 }),
      sources,
    ) as unknown as Record<string, unknown>
    const workspace = workspaceOf(
      fold([
        event('tool/call', {
          callId: 'w1',
          name: 'zotero_retrieve',
          arguments: JSON.stringify({
            mode: 'fulltext',
            source: { kind: 'ref', ref: REF },
            start: 0,
          }),
        }),
        event('tool/result', { message: { toolCallId: 'w1', content: [] }, meta: first }),
        event('tool/call', {
          callId: 'w2',
          name: 'zotero_retrieve',
          arguments: JSON.stringify({
            mode: 'fulltext',
            source: { kind: 'ref', ref: REF },
            start: 12_000,
          }),
        }),
        event('tool/result', { message: { toolCallId: 'w2', content: [] }, meta: second }),
      ]),
    )
    expect(
      workspace.sources[0]!.fulltextReads.map((read) => [read.start, read.end, read.callIds]),
    ).toEqual([
      [0, 12_000, ['w1']],
      [12_000, 24_000, ['w2']],
    ])
  })

  it('keeps two windows apart when only their coverage differs', () => {
    // `fulltextKeyOf` is the dedup identity; a key without `coverage` would
    // merge a partial index read with a complete parsed read of the same span.
    const sources = ['annotation', 'note', 'abstract', 'fulltext'] as const
    const partial = projectRetrieveMeta(
      fulltextResult({ coverage: { indexedPages: 2, totalPages: 4, complete: false } }),
      sources,
    ) as unknown as Record<string, unknown>
    const complete = projectRetrieveMeta(
      fulltextResult({ coverage: { indexedPages: 4, totalPages: 4, complete: true } }),
      sources,
    ) as unknown as Record<string, unknown>
    const workspace = workspaceOf(
      fold([
        event('tool/call', {
          callId: 'w1',
          name: 'zotero_retrieve',
          arguments: JSON.stringify({
            mode: 'fulltext',
            source: { kind: 'ref', ref: REF },
            start: 0,
          }),
        }),
        event('tool/result', { message: { toolCallId: 'w1', content: [] }, meta: partial }),
        event('tool/call', {
          callId: 'w2',
          name: 'zotero_retrieve',
          arguments: JSON.stringify({
            mode: 'fulltext',
            source: { kind: 'ref', ref: REF },
            start: 0,
          }),
        }),
        event('tool/result', { message: { toolCallId: 'w2', content: [] }, meta: complete }),
      ]),
    )
    expect(workspace.sources[0]!.fulltextReads).toHaveLength(2)
    expect(workspace.sources[0]!.fulltextReads.map((read) => read.coverage?.complete)).toEqual([
      false,
      true,
    ])
  })
})

/** One workspace whose only source carries one projected fulltext window. */
function oneWindowWorkspace(): ReturnType<typeof workspaceOf> {
  const meta = projectRetrieveMeta(fulltextResult(), [
    'annotation',
    'note',
    'abstract',
    'fulltext',
  ]) as unknown as Record<string, unknown>
  return workspaceOf(fulltextState(meta))
}

/** The same workspace with its fulltext rows writable, for shape refusals. */
function mutableWorkspace(): { sources: { fulltextReads: Record<string, unknown>[] }[] } {
  return structuredClone(oneWindowWorkspace()) as never
}

describe('the wire schema refuses a row the projection could not produce', () => {
  it('accepts the projected row it was built from', () => {
    // Negative control for the two refusals below: the same workspace parses
    // until a refine-relevant field is corrupted.
    expect(sourceWorkspaceSchema.safeParse(mutableWorkspace()).success).toBe(true)
  })

  it('refuses a window that ends before it starts', () => {
    const workspace = mutableWorkspace()
    const row = workspace.sources[0]!.fulltextReads[0]!
    row.start = 12_000
    row.end = 0
    expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(false)
  })

  it('refuses an artifact on a window that is not Markdown', () => {
    const workspace = mutableWorkspace()
    const row = workspace.sources[0]!.fulltextReads[0]!
    row.textFormat = 'text'
    row.artifact = {
      parser: 'mineru',
      mode: 'free',
      artifactId: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
      sourceId: 'c'.repeat(64),
      generation: 'd'.repeat(64),
    }
    expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(false)
  })
})

it('merges a fulltext attachment read into its proved parent and preserves PDF and server identity in the broadcast', () => {
  const parent = 'zotero://user/0/item/ABCD1234'
  const attachment = `${REF}?server=S1`
  const result = fulltextResult({
    attachmentRef: attachment,
    attachmentContentType: 'application/pdf',
    item: {
      ref: `${parent}?server=S1`,
      title: 'Proved parent title',
      creatorSummary: 'A. Researcher',
      year: 2026,
      venue: 'Journal',
    },
  })
  const state = fold([
    event('tool/call', {
      callId: 'parent',
      name: 'zotero_get',
      arguments: JSON.stringify({ ref: parent }),
    }),
    event('tool/result', {
      message: { toolCallId: 'parent', content: [] },
      meta: { title: 'Earlier title' },
    }),
    event('tool/call', {
      callId: 'read',
      name: 'zotero_retrieve',
      arguments: JSON.stringify({ mode: 'fulltext', source: { kind: 'ref', ref: REF } }),
    }),
    event('tool/result', {
      message: { toolCallId: 'read', content: [] },
      meta: projectRetrieveMeta(result, []),
    }),
  ])
  const workspace = workspaceOf(state, 'S1')
  expect(workspace.sources).toHaveLength(1)
  expect(workspace.sources[0]).toMatchObject({
    title: 'Proved parent title',
    creators: 'A. Researcher',
    year: 2026,
    venue: 'Journal',
    evidenceMatch: 'verified',
    serverIds: ['S1'],
    fulltextReadsTotal: 1,
    readAttachment: { ref: attachment, contentType: 'application/pdf' },
  })
  const wire = createSourceLedgerProjection().definition.wire.view({ ledger: state })
  expect(wire.sources[0]?.readAttachment).toEqual({
    ref: attachment,
    contentType: 'application/pdf',
  })
  expect(sourceWorkspaceSchema.safeParse(wire).success).toBe(true)
})
