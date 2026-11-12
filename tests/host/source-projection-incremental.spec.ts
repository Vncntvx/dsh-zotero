/**
 * The literature trail's incremental fold: a view costs the blocks folded
 * since the last read, not the session's whole log.
 *
 * The load-bearing claims are that a settled block is folded once however
 * often the view is read, that a view reuses every frozen item it did not
 * touch, that a pending call merges exactly as the one-shot build merges it,
 * that one read cut is built once, and that the fold cache dies with its
 * owner. The host runs `wire.view` on every committed event, so a per-view
 * refold would make a long session's trail quadratic.
 * @module tests/host/source-projection-incremental
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type {
  RunningToolBlock,
  SettledToolBlock,
  ToolBlockLike,
} from '../../src/sources/block-types.js'
import { SourceWorkspaceIndex, buildSourceWorkspace } from '../../src/sources/ledger.js'
import type { SourceWorkspace } from '../../src/sources/model.js'
import { createSourceLedgerProjection } from '../../src/session-projection/source-ledger.js'
import type { SourceLedgerProjectionState } from '../../src/sources/event-ledger.js'
import { sourceWorkspaceSchema } from '../../src/sources/workspace-schema.js'

let seq = 0

/** One committed event as the fold reads it. */
interface RawEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

function event(type: string, data: unknown): RawEvent {
  seq += 1
  return { type, seq, time: seq * 1000, data }
}

/** One item ref in the specs' spelling. */
const REF = (key: string, serverId?: string): string =>
  `zotero://user/0/item/${key}${serverId === undefined ? '' : `?server=${serverId}`}`

/** The search projection one settled `zotero_search` carries. */
function searchMetaOf(rows: readonly string[]): Record<string, unknown> {
  return {
    returned: rows.length,
    total: rows.length,
    displayed: rows.length,
    omitted: 0,
    items: rows.map((ref) => ({
      ref,
      title: `Paper ${ref.slice(-4)}`,
      creatorSummary: 'Creator',
      year: 2020,
    })),
  }
}

/** The two events of one settled search. */
function searchEvents(callId: string, rows: readonly string[]): readonly RawEvent[] {
  return [
    event('tool/call', {
      callId,
      name: 'zotero_search',
      arguments: JSON.stringify({ query: callId }),
    }),
    event('tool/result', {
      message: { toolCallId: callId, content: [{ type: 'text', text: 'ok' }] },
      meta: searchMetaOf(rows),
    }),
  ]
}

/** The two events of one settled get. */
function getEvents(callId: string, ref: string, title: string): readonly RawEvent[] {
  return [
    event('tool/call', { callId, name: 'zotero_get', arguments: JSON.stringify({ ref }) }),
    event('tool/result', {
      message: { toolCallId: callId, content: [{ type: 'text', text: 'ok' }] },
      meta: { title, creators: 'Creator', year: 2020, venue: 'NeurIPS' },
    }),
  ]
}

/** One settled block with the given argument payload and presentation meta. */
function settledBlock(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  meta: unknown,
  index: number,
): SettledToolBlock {
  const argsRaw = JSON.stringify(args)
  return {
    kind: 'tool-result',
    seq: index,
    time: index * 1000,
    callId,
    name,
    args: PartialArguments.fromText(argsRaw),
    call: { name, argsRaw },
    callTime: index * 1000,
    content: [],
    isError: false,
    meta,
    subCalls: [],
  }
}

/** One dispatched call whose result has not landed. */
function runningBlock(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): RunningToolBlock {
  return {
    phase: 'start',
    callId,
    name,
    args: PartialArguments.fromText(JSON.stringify(args)),
    subCalls: [],
  }
}

/** One session driven through its own projection instance. */
interface Trail {
  readonly projection: ReturnType<typeof createSourceLedgerProjection>
  state(): SourceLedgerProjectionState
  fold(events: readonly RawEvent[]): void
  apply(entry: RawEvent): void
  view(): SourceWorkspace
  full(currentServerId?: string): SourceWorkspace
}

function trail(inherited = 0): Trail {
  const projection = createSourceLedgerProjection()
  const { definition } = projection
  let state = definition.init({} as never, inherited as never)
  return {
    projection,
    state: () => state,
    fold: (events) => {
      for (const entry of events) state = definition.apply(state, entry as never)
    },
    apply: (entry) => {
      state = definition.apply(state, entry as never)
    },
    view: () => definition.wire.view(state),
    full: (currentServerId) => projection.fullWorkspaceOf(state, currentServerId),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the incremental literature-trail fold', () => {
  it('folds each settled block once while the view is read after every result', () => {
    const applySpy = vi.spyOn(SourceWorkspaceIndex.prototype, 'apply')
    const session = trail()
    for (let index = 0; index < 40; index += 1) {
      const events = searchEvents(`c${index}`, [REF(`K${String(index).padStart(4, '0')}`)])
      for (const entry of events) {
        session.apply(entry)
        if (entry.type === 'tool/result') session.view()
      }
    }
    // Forty settled results, forty folds: a view reads the fold instead of
    // replaying the log (which would be one fold per block per view).
    expect(applySpy).toHaveBeenCalledTimes(40)
    const workspace = session.view()
    expect(workspace.sources).toHaveLength(40)
    expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(true)
  })

  it('folds one pending call per view and never refolds the settled prefix', () => {
    const applySpy = vi.spyOn(SourceWorkspaceIndex.prototype, 'apply')
    const session = trail()
    for (let index = 0; index < 40; index += 1) {
      for (const entry of searchEvents(`c${index}`, [REF(`K${String(index).padStart(4, '0')}`)])) {
        session.apply(entry)
        // The live drive reads the view after every committed event, including
        // the call whose result is still out.
        session.view()
      }
    }
    // Two folds per pair at most: the settled block, plus the one in-flight
    // call the pending overlay folds into its own throwaway index.
    expect(applySpy.mock.calls.length).toBeLessThanOrEqual(80)
  })

  it('reuses every frozen item the fold did not touch', () => {
    const session = trail()
    session.fold(searchEvents('c1', [REF('AAAA1111'), REF('BBBB2222')]))
    const firstView = session.view()
    const [firstItem, secondItem] = firstView.sources
    // An unchanged read hands back the same object: the harness publishes a
    // change only when the raw view differs by identity.
    expect(session.view()).toBe(firstView)

    session.fold(searchEvents('c2', [REF('CCCC3333')]))
    const secondView = session.view()
    expect(secondView).not.toBe(firstView)
    expect(secondView.sources[0]).toBe(firstItem)
    expect(secondView.sources[1]).toBe(secondItem)
    expect(secondView.sources[2]?.ref).toBe(REF('CCCC3333'))

    // One touched item rebuilds one item.
    session.fold(getEvents('g1', REF('AAAA1111'), 'Attention Is All You Need'))
    const thirdView = session.view()
    expect(thirdView.sources[0]).not.toBe(firstItem)
    expect(thirdView.sources[0]?.title).toBe('Attention Is All You Need')
    expect(thirdView.sources[1]).toBe(secondItem)
    expect(thirdView.sources[2]).toBe(secondView.sources[2])
  })

  it('keeps one fold per session while two sessions interleave', () => {
    const { definition } = createSourceLedgerProjection()
    let first = definition.init({} as never, 0 as never)
    let second = definition.init({} as never, 0 as never)
    for (const entry of searchEvents('a1', [REF('AAAA1111')])) {
      first = definition.apply(first, entry as never)
    }
    const firstView = definition.wire.view(first)
    for (const entry of searchEvents('b1', [REF('BBBB2222')])) {
      second = definition.apply(second, entry as never)
    }
    expect(definition.wire.view(second).sources.map((item) => item.ref)).toEqual([REF('BBBB2222')])

    // The first session's fold survived the second session's activity: its
    // already-frozen item comes back unchanged instead of being rebuilt.
    for (const entry of searchEvents('a2', [REF('CCCC3333')])) {
      first = definition.apply(first, entry as never)
    }
    const continued = definition.wire.view(first)
    expect(continued.sources.map((item) => item.ref)).toEqual([REF('AAAA1111'), REF('CCCC3333')])
    expect(continued.sources[0]).toBe(firstView.sources[0])
  })

  it('merges the pending tail exactly like the one-shot build', () => {
    const settled: readonly ToolBlockLike[] = [
      settledBlock(
        'r1',
        'zotero_search',
        { query: 'attention' },
        searchMetaOf([REF('AAAA1111'), REF('BBBB2222')]),
        0,
      ),
    ]
    // One case per block kind a call can be in flight as: the settled item's
    // running count grows and, when the pending ref carries a Server ID, so
    // does its identity verdict. Every case must match the one-shot build
    // field for field, which is what lets the wire view skip the settled
    // prefix while a call is out.
    const cases: ReadonlyArray<readonly [string, RunningToolBlock]> = [
      ['zotero_get on a known ref', runningBlock('p1', 'zotero_get', { ref: REF('AAAA1111') })],
      [
        'zotero_get on a qualified new ref',
        runningBlock('p2', 'zotero_get', { ref: REF('DDDD4444', 'SERVER9') }),
      ],
      [
        'zotero_retrieve on a known ref',
        runningBlock('p3', 'zotero_retrieve', { ref: REF('BBBB2222'), query: 'attention' }),
      ],
      [
        'zotero_export of a known ref',
        runningBlock('p4', 'zotero_export', { refs: [REF('AAAA1111')], format: 'ris' }),
      ],
      [
        'zotero_get_batch over known and new refs',
        runningBlock('p5', 'zotero_get_batch', { refs: [REF('AAAA1111'), REF('EEEE5555')] }),
      ],
      ['zotero_search', runningBlock('p6', 'zotero_search', { query: 'pending' })],
      [
        'zotero_match_references',
        runningBlock('p7', 'zotero_match_references', { references: ['Some title'] }),
      ],
    ]
    for (const [label, pending] of cases) {
      const index = new SourceWorkspaceIndex()
      for (const entry of settled) index.apply(entry)
      const incremental = index.workspace([pending], {
        windowed: false,
        currentServerId: 'SERVER1',
      })
      const oneShot = buildSourceWorkspace([...settled, pending], {
        windowed: false,
        currentServerId: 'SERVER1',
      })
      expect(incremental, label).toEqual(oneShot)
    }
  })

  it('builds one read cut once and shares it with the wire view', () => {
    const session = trail()
    session.fold(searchEvents('c1', [REF('AAAA1111', 'SERVER1')]))
    const first = session.full('SERVER1')
    expect(session.full('SERVER1')).toBe(first)
    expect(first.sources[0]?.evidenceMatch).toBe('verified')
    // The wire view keeps its own cache: unknown instance, unknown verdict,
    // and its own object, without evicting the paging read's fold.
    expect(session.view().sources[0]?.evidenceMatch).toBe('unknown')
    expect(session.full('SERVER1')).toBe(first)

    session.fold(searchEvents('c2', [REF('BBBB2222', 'SERVER1')]))
    expect(session.full('SERVER1')).not.toBe(first)
    expect(session.full('SERVER1').sources).toHaveLength(2)
  })

  it('rebuilds once for a state it never folded and keeps folding it', () => {
    const session = trail()
    session.fold(searchEvents('c1', [REF('AAAA1111')]))
    const original = session.view()
    const restored = JSON.parse(JSON.stringify(session.state())) as SourceLedgerProjectionState
    const fresh = createSourceLedgerProjection()
    expect(fresh.definition.wire.view(restored)).toEqual(original)

    const next = searchEvents('c2', [REF('BBBB2222')])
    let state = fresh.definition.apply(restored, next[0] as never)
    state = fresh.definition.apply(state, next[1] as never)
    expect(fresh.definition.wire.view(state).sources.map((item) => item.ref)).toEqual([
      REF('AAAA1111'),
      REF('BBBB2222'),
    ])
  })

  it('drops every cached fold on dispose', () => {
    const session = trail()
    session.fold(searchEvents('c1', [REF('AAAA1111')]))
    const wireView = session.view()
    const fullView = session.full()
    session.projection.dispose()
    // The definition stays usable, but nothing is served from the old cache.
    const afterWire = session.view()
    const afterFull = session.full()
    expect(afterWire).not.toBe(wireView)
    expect(afterWire).toEqual(wireView)
    expect(afterFull).not.toBe(fullView)
    expect(afterFull).toEqual(fullView)
  })

  it('folds one block per event however long the session runs', () => {
    // The guard is the fold count, not wall time: a view that replayed the log
    // would fold ~N²/2 blocks, while a wall-clock ratio also moves with the
    // coverage instrumentation the gate runs under. Spying on the reducer
    // counts the work itself, so the assertion says what the fix guarantees.
    const applySpy = vi.spyOn(SourceWorkspaceIndex.prototype, 'apply')
    const counts: Record<number, number> = {}
    for (const count of [50, 100, 200, 400]) {
      applySpy.mockClear()
      const session = trail()
      for (let index = 0; index < count; index += 1) {
        for (const entry of searchEvents(`c${index}`, [
          REF(`K${String(index).padStart(4, '0')}`),
        ])) {
          session.apply(entry)
          session.view()
        }
      }
      counts[count] = applySpy.mock.calls.length
    }
    // Exactly two folds per call/result pair at every size — the settled block
    // and the in-flight call the view folds into its own throwaway index —
    // never the whole log: a replaying view would fold ~N²/2.
    expect(counts).toEqual({ 50: 100, 100: 200, 200: 400, 400: 800 })
  })

  it('keeps the fork-inherited prefix length on the state it initialized', () => {
    const session = trail(3)
    session.fold(searchEvents('c1', [REF('AAAA1111')]))
    expect(session.state().inheritedEventCount).toBe(3)
    expect(session.view().sources).toHaveLength(1)
  })
})
