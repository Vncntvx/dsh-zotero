/**
 * The host-side literature-trail fold: settled Zotero outcomes become a
 * bounded workspace, unrelated and malformed events change nothing, and the
 * projection state survives a JSON round trip.
 * @module tests/host/source-ledger
 */

import { describe, expect, it } from 'vitest'
import { RESULT_RECEIPT_PREFIX } from '../../src/constants.js'

import {
  emptyLedgerState,
  foldLedgerEvent,
  workspaceOf,
  type SourceLedgerState,
} from '../../src/sources/event-ledger.js'
import {
  sourceLedgerProjection,
  sourceWorkspaceSchema,
} from '../../src/session-projection/source-ledger.js'

let seq = 0

/** One committed event as the fold reads it. */
function event(type: string, data: unknown): never {
  seq += 1
  return { type, seq, time: seq * 1000, data } as never
}

const REF = 'zotero://user/0/item/ABCD1234?server=SERVER1'

const SEARCH_META = {
  returned: 1,
  total: 1,
  displayed: 1,
  omitted: 0,
  items: [{ ref: REF, title: 'Attention Is All You Need', creatorSummary: 'Vaswani', year: 2017 }],
}

/** Fold the event list, starting from the empty state. */
function fold(events: readonly never[]): SourceLedgerState {
  return events.reduce((state, entry) => foldLedgerEvent(state, entry), emptyLedgerState())
}

describe('the host literature-trail fold', () => {
  it('records one settled Zotero search', () => {
    const state = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-1',
        name: 'zotero_search',
        arguments: JSON.stringify({ query: 'attention' }),
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] },
        meta: SEARCH_META,
      }),
    ])

    const workspace = workspaceOf(state)
    expect(workspace.sources).toHaveLength(1)
    expect(workspace.sources[0]?.ref).toBe(REF)
    expect(workspace.sources[0]?.serverIds).toEqual(['SERVER1'])
    expect(workspace.sources[0]?.searches[0]?.query).toBe('attention')
  })

  it('ignores unrelated tools and malformed results without throwing', () => {
    const state = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-2',
        name: 'zotero_get',
        arguments: '{not-json',
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-2', content: 'not-an-array', isError: true },
        meta: { title: 'still no crash' },
      }),
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-3',
        name: 'web_search',
        arguments: '{}',
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-3', content: [] },
      }),
    ])
    expect(state.blocks).toHaveLength(1)
    expect(() => workspaceOf(state)).not.toThrow()
  })

  it('counts a settled retrieve as one evidence run', () => {
    const state = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-4',
        name: 'zotero_retrieve',
        arguments: JSON.stringify({ ref: REF, query: 'attention' }),
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-4', content: [{ type: 'text', text: 'passage' }] },
        meta: {
          items: [
            {
              source: 'fulltext',
              sourceRef: REF,
              preview: 'Self-attention relates positions.',
              previewTruncated: false,
            },
          ],
          count: 1,
          coverage: { complete: true },
          sourceAvailability: {},
          truncated: false,
        },
      }),
    ])
    const item = workspaceOf(state).sources[0]
    expect(item?.retrievalSummary?.runCount).toBe(1)
    expect(item?.evidence[0]?.text).toContain('Self-attention')
  })

  it('counts an unsettled call that names an item as a running operation', () => {
    const state = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-running',
        name: 'zotero_get',
        arguments: JSON.stringify({ ref: REF }),
      }),
    ])
    const item = workspaceOf(state).sources[0]
    expect(item?.operations.running).toBe(1)
  })

  it('drops a call that never settled when the next turn starts', () => {
    const started = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-5',
        name: 'zotero_search',
        arguments: '{}',
      }),
    ])
    expect(Object.keys(started.pending)).toHaveLength(1)
    const next = foldLedgerEvent(started, event('turn/start', { turn: 2 }))
    expect(Object.keys(next.pending)).toHaveLength(0)
    expect(next.blocks).toHaveLength(0)
    expect(foldLedgerEvent(next, event('turn/start', { turn: 3 }))).toBe(next)
  })

  it('records a nested PTC dispatch', () => {
    const state = fold([
      event('tool/ptc-dispatch-start', {
        rootCallId: 'root-1',
        parentCallId: 'root-1',
        subCallId: 'root-1:ptc:1',
        name: 'zotero_get',
        arguments: { ref: REF },
      }),
      event('tool/ptc-dispatch', {
        rootCallId: 'root-1',
        parentCallId: 'root-1',
        subCallId: 'root-1:ptc:1',
        name: 'zotero_get',
        arguments: { ref: REF },
        isError: false,
        content: [{ type: 'text', text: 'title' }],
        meta: { title: 'Attention Is All You Need' },
      }),
    ])
    expect(state.blocks).toHaveLength(1)
    expect(workspaceOf(state).sources[0]?.title).toBe('Attention Is All You Need')
  })

  it('keeps a repeated PTC dispatch for the same subCallId a no-op', () => {
    const settle = {
      rootCallId: 'root-1',
      parentCallId: 'root-1',
      subCallId: 'root-1:ptc:1',
      name: 'zotero_get',
      arguments: { ref: REF },
      isError: false,
      content: [{ type: 'text', text: 'title' }],
      meta: { title: 'Attention Is All You Need' },
    }
    const state = fold([
      event('tool/ptc-dispatch-start', settle),
      event('tool/ptc-dispatch', settle),
      event('tool/ptc-dispatch', settle),
    ])
    expect(state.blocks).toHaveLength(1)
  })

  it('records a PTC dispatch that outlives its turn, whose pending was cleared', () => {
    const state = fold([
      event('tool/ptc-dispatch-start', {
        rootCallId: 'root-1',
        parentCallId: 'root-1',
        subCallId: 'root-1:ptc:1',
        name: 'zotero_get',
        arguments: { ref: REF },
      }),
      event('turn/start', { turn: 2 }),
      event('tool/ptc-dispatch', {
        rootCallId: 'root-1',
        parentCallId: 'root-1',
        subCallId: 'root-1:ptc:1',
        name: 'zotero_get',
        arguments: { ref: REF },
        isError: false,
        content: [{ type: 'text', text: 'title' }],
        meta: { title: 'Attention Is All You Need' },
      }),
    ])
    // The late dispatch must still land: the trail records subagent outcomes
    // that outlive the turn which started them.
    expect(state.blocks).toHaveLength(1)
    expect(workspaceOf(state).sources[0]?.title).toBe('Attention Is All You Need')
  })

  it('keeps a job_output result only when it carries a durable receipt', () => {
    const receipt = {
      delivery: 'file',
      version: 1,
      tool: 'zotero_export',
      sessionId: 'session',
      callId: 'call-export',
      summary: 'zotero_export: full result persisted.',
      file: { attachmentId: 'attachment-1', name: 'export.json', bytes: 12 },
    }
    const withReceipt = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-job-1',
        name: 'job_output',
        arguments: JSON.stringify({ job_id: 'job-1' }),
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          toolCallId: 'call-job-1',
          content: [
            { type: 'text', text: `${RESULT_RECEIPT_PREFIX}${JSON.stringify(receipt)}` },
            { type: 'file', attachment: { attachmentId: 'attachment-1', name: 'export.json' } },
          ],
        },
      }),
    ])
    expect(withReceipt.blocks).toHaveLength(1)

    const withoutReceipt = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-job-2',
        name: 'job_output',
        arguments: JSON.stringify({ job_id: 'job-2' }),
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-job-2', content: [{ type: 'text', text: 'plain' }] },
      }),
    ])
    expect(withoutReceipt.blocks).toHaveLength(0)
  })

  it('records one call once when its result is replayed', () => {
    const call = event('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-dup',
      name: 'zotero_search',
      arguments: JSON.stringify({ query: 'attention' }),
    })
    const result = event('tool/result', {
      turn: 1,
      step: 1,
      message: { toolCallId: 'call-dup', content: [] },
      meta: SEARCH_META,
    })
    const once = fold([call, result])
    const replayed = foldLedgerEvent(once, result)
    expect(replayed).toBe(once)
    expect(once.blocks).toHaveLength(1)
  })

  it('keeps the state and the served value JSON-safe', () => {
    const state = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-6',
        name: 'zotero_search',
        arguments: JSON.stringify({ query: 'attention' }),
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-6', content: [{ type: 'text', text: 'ok' }] },
        meta: SEARCH_META,
      }),
    ])
    const projectionState = { inheritedEventCount: 0, ledger: state }
    const roundTripped = JSON.parse(JSON.stringify(projectionState))
    expect(sourceLedgerProjection.stateSchema.safeParse(roundTripped).success).toBe(true)
    expect(sourceWorkspaceSchema.safeParse(workspaceOf(state)).success).toBe(true)
  })

  it('folds inherited events from a fork', () => {
    const state = fold([
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-7',
        name: 'zotero_search',
        arguments: JSON.stringify({ query: 'attention' }),
      }),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: { toolCallId: 'call-7', content: [] },
        meta: SEARCH_META,
      }),
    ])
    const projectionState = { inheritedEventCount: 99, ledger: state }
    expect(sourceLedgerProjection.wire.view(projectionState).sources).toHaveLength(1)
  })
})

describe('the projection lifecycle', () => {
  it('initializes, folds, and serves through the registered definition', () => {
    const initial = sourceLedgerProjection.init({} as never, 0 as never)
    expect(initial).toEqual({
      inheritedEventCount: 0,
      ledger: { blocks: [], pending: {}, recorded: {} },
    })

    const called = sourceLedgerProjection.apply(
      initial,
      event('tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-lifecycle',
        name: 'zotero_search',
        arguments: JSON.stringify({ query: 'attention' }),
      }),
    )
    expect(called).not.toBe(initial)
    expect(Object.keys(called.ledger.pending)).toEqual(['call-lifecycle'])

    const unrelated = event('user/message', { text: 'hello' })
    expect(sourceLedgerProjection.apply(called, unrelated)).toBe(called)
    expect(sourceLedgerProjection.wire.summary).toBe(false)
    expect(sourceLedgerProjection.wire.view(called).sources).toEqual([])
  })
})
