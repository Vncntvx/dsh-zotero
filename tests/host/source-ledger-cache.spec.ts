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
import { createSourceLedgerProjection } from '../../src/session-projection/source-ledger.js'
import { zoteroSourcePageRequestSchema } from '../../src/wire-schemas.js'
import { REF, searchIndex, settledBlock } from './support/source-ledger-arms.js'

let seq = 0

function event(type: string, data: unknown): never {
  seq += 1
  return { type, seq, time: seq * 1000, data } as never
}

function searchPair(callId: string): never[] {
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
      { blockChunks: [], pending: {}, recorded: {} },
      event('tool/call', { callId: 'b1', name: 'zotero_browse', arguments: '{}' }),
    )
    state = foldLedgerEvent(
      state,
      event('tool/result', {
        message: { toolCallId: 'b1', content: [], isError: false },
      }),
    )
    expect(factsOf(state)).toEqual([])
  })

  it('appends facts in bounded chunks and replays them in order', () => {
    let state = foldLedgerEvent(
      { blockChunks: [], pending: {}, recorded: {} },
      event('turn/start', {}),
    )
    for (let i = 0; i < 600; i += 1) {
      for (const next of searchPair(`c${i}`)) state = foldLedgerEvent(state, next)
    }
    expect(factsOf(state)).toHaveLength(600)
    expect(state.blockChunks.map((chunk) => chunk.length)).toEqual([256, 256, 88])
    expect(state.blockChunks.every((chunk) => chunk.length <= 256)).toBe(true)
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
