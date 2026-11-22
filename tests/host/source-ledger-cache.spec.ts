import type { SessionEvent } from '@deepseek-ai/dsh-session'
/**
 * The incremental ledger's cache contracts: scalar aggregates invalidate the
 * view, the page-view cache is bounded by the wire view plus the current
 * instance, the block store appends in short chunks, and the projection folds
 * nothing until its first view.
 * @module tests/host/source-ledger-cache
 */

import { describe, expect, it, vi } from 'vitest'
import { factsOf, foldLedgerEvent } from '../../src/sources/event-ledger.js'
import { SourceWorkspaceIndex } from '../../src/sources/ledger.js'
import {
  createSourceLedgerProjection,
  ledgerStateSchema,
} from '../../src/session-projection/source-ledger.js'
import { zoteroSourcePageRequestSchema } from '../../src/wire-schemas.js'
import { REF, searchIndex, settledBlock } from './support/source-ledger-arms.js'
import { createEventFactory } from './support/source-ledger-events.js'

const event = createEventFactory()

function searchPair(callId: string): SessionEvent[] {
  return [
    event('tool/call', {
      callId,
      name: 'zotero_search',
      arguments: JSON.stringify({ query: callId }),
    }),
    event('tool/result', {
      message: { toolCallId: callId, content: [], isError: false },
    }),
  ]
}

describe('scalar aggregate invalidation', () => {
  it('rebuilds the view when a ref-less failed export changes the counts', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    const settled = index.workspace([], { windowed: false })
    const failed = {
      ...settledBlock('e1', 'zotero_export', {}, null, 2),
      isError: true,
    }
    index.apply(failed)
    const after = index.workspace([], { windowed: false })
    expect(after).not.toBe(settled)
    expect(after.exportOperations).toEqual({ running: 0, failed: 1, stopped: 0 })
    // A second read with no change returns the same object.
    expect(index.workspace([], { windowed: false })).toBe(after)
  })
})

describe('the page-view cache', () => {
  it('keeps the wire view plus at most one connected instance', () => {
    const index = searchIndex([{ ref: REF('AAAA1111') }])
    for (let id = 0; id < 300; id += 1) {
      index.workspace([], { currentServerId: `S${id}`, windowed: false })
    }
    const caches = (index as unknown as { viewCaches: Map<string | undefined, unknown> }).viewCaches
    expect(caches.size).toBeLessThanOrEqual(2)
    expect(caches.has('S299')).toBe(true)
    expect(caches.has('S0')).toBe(false)
  })

  it('rejects a server id long enough to grow the cache key without bound', () => {
    const parsed = zoteroSourcePageRequestSchema.safeParse({
      sessionId: 's1',
      target: { kind: 'sources', filter: 'all' },
      currentServerId: 'x'.repeat(129),
    })
    expect(parsed.success).toBe(false)
  })
})

describe('chunked block storage', () => {
  it('does not record a read tool the trail has no fold arm for', () => {
    let state = foldLedgerEvent(
      { pending: {}, recorded: {} },
      event('tool/call', { callId: 'b1', name: 'zotero_browse', arguments: '{}' }),
    )
    state = foldLedgerEvent(
      state,
      event('tool/result', {
        message: { toolCallId: 'b1', content: [], isError: false },
      }),
    )
    expect(factsOf(state)).toEqual([])
    expect(state.blockChunks).toBeUndefined()
  })

  it('appends facts in bounded chunks and replays them in order', () => {
    let state = foldLedgerEvent(
      { pending: {}, recorded: {} },
      event('turn/start', { turn: 1 }),
    )
    for (let i = 0; i < 600; i += 1) {
      for (const next of searchPair(`c${i}`)) state = foldLedgerEvent(state, next)
    }
    expect(factsOf(state)).toHaveLength(600)
    // The harness chunked list shares older chunks and copies at most one
    // 64-value chunk per append; 600 facts land in 10 chunks of 64 minus 8.
    const chunkSizes: number[] = []
    for (let node = state.blockChunks; node !== undefined; node = node.previous) {
      chunkSizes.unshift(node.values.length)
    }
    expect(chunkSizes).toEqual([64, 64, 64, 64, 64, 64, 64, 64, 64, 24])
    expect(chunkSizes.every((size) => size <= 64)).toBe(true)
    // The writer's bound is the schema's bound: a replayed state cannot carry
    // a chunk the fold would never produce.
    expect(ledgerStateSchema.safeParse(state).success).toBe(true)
  })

  it('refuses an oversized chunk and an unknown field in the stored shape', () => {
    const fact = {
      callId: 'c1',
      seq: 1,
      time: 1000,
      name: 'zotero_search',
      argsRaw: '{}',
      callTime: 1000,
      content: [],
      isError: false,
    }
    // 65 values in one chunk exceeds the harness chunk capacity.
    const oversized: unknown = { values: Array.from({ length: 65 }, () => fact) }
    expect(ledgerStateSchema.safeParse({ blockChunks: oversized, pending: {}, recorded: {} }).success)
      .toBe(false)
    // An unknown field in a chunk node is rejected, not carried.
    const unknownField: unknown = {
      values: [fact],
      previous: undefined,
      extra: true,
    }
    expect(ledgerStateSchema.safeParse({ blockChunks: unknownField, pending: {}, recorded: {} }).success)
      .toBe(false)
    // The empty list is the absent key, and a well-formed single chunk parses.
    expect(ledgerStateSchema.safeParse({ pending: {}, recorded: {} }).success).toBe(true)
    expect(
      ledgerStateSchema.safeParse({ blockChunks: { values: [fact] }, pending: {}, recorded: {} })
        .success,
    ).toBe(true)
  })
})

describe('the lazy projection fold', () => {
  it('folds nothing before the first view, then only new blocks', () => {
    const spy = vi.spyOn(SourceWorkspaceIndex.prototype, 'apply')
    const projection = createSourceLedgerProjection()
    let state = projection.definition.init({} as never, 0 as never)
    for (const next of searchPair('lazy-1')) state = projection.definition.apply(state, next)
    expect(spy).not.toHaveBeenCalled()

    projection.definition.wire.view(state)
    expect(spy).toHaveBeenCalledTimes(1)

    for (const next of searchPair('lazy-2')) state = projection.definition.apply(state, next)
    expect(spy).toHaveBeenCalledTimes(2)
    projection.dispose()
    spy.mockRestore()
  })
})
