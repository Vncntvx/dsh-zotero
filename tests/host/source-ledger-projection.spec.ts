/** The registered projection definition's lifecycle and read-only trail scope. */
/**
 * The host-side literature-trail fold: settled Zotero outcomes become a
 * bounded workspace, unrelated and malformed events change nothing, and the
 * projection state survives a JSON round trip.
 * @module tests/host/source-ledger
 */

import { describe, expect, it } from 'vitest'

import { emptyLedgerState, factsOf, foldLedgerEvent } from '../../src/sources/event-ledger.js'
import { createSourceLedgerProjection } from '../../src/session-projection/source-ledger.js'

let seq = 0

/** One committed event as the fold reads it. */
function event(type: string, data: unknown): never {
  seq += 1
  return { type, seq, time: seq * 1000, data } as never
}

describe('the projection lifecycle', () => {
  it('initializes, folds, and serves through the registered definition', () => {
    const { definition } = createSourceLedgerProjection()
    const initial = definition.init({} as never, 0 as never)
    expect(initial).toEqual({
      inheritedEventCount: 0,
      ledger: { blockChunks: [], pending: {}, recorded: {} },
    })

    const called = definition.apply(
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
    expect(definition.apply(called, unrelated)).toBe(called)
    expect(definition.wire.summary).toBe(false)
    expect(definition.wire.view(called).sources).toEqual([])
  })

  it('never records a write tool in the projection state', () => {
    const state = emptyLedgerState()
    const call = foldLedgerEvent(
      state,
      event('tool/call', {
        callId: 'w1',
        name: 'zotero_create_note',
        arguments: '{"markdown":"x"}',
      }),
    )
    expect(call).toBe(state)
    const result = foldLedgerEvent(
      call,
      event('tool/result', {
        message: {
          toolCallId: 'w1',
          content: [{ type: 'text', text: 'created' }],
          isError: false,
        },
        meta: { kind: 'applied', ref: 'zotero://user/0/item/ABCD1234' },
      }),
    )
    // No block, no recorded entry: the trail is a read ledger, and folding a
    // write used to grow the projection state for the session's lifetime.
    expect(result).toBe(call)
    expect(factsOf(result)).toEqual([])
    expect(result.recorded).toEqual({})
  })
})
