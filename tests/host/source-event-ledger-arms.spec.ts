/**
 * The host event fold's defensive arms: malformed and partial session events
 * are skipped or read at position zero, a settled error replays into the
 * source's stopped operation, a dispatch keeps its text arguments, missing
 * argument payloads and non-block content degrade to empty, and the connected
 * instance verdict is applied when the caller knows it. The settled-outcome
 * fold itself lives in `source-ledger.spec.ts`; the workspace-side arms live
 * in `source-ledger-arms.spec.ts`. The `as never` casts mark deliberately
 * malformed session events, the boundary whose contract is to skip them
 * without throwing.
 * @module tests/host/source-event-ledger-arms
 */

import { describe, expect, it } from 'vitest'
import {
  emptyLedgerState,
  factsOf,
  foldLedgerEvent,
  workspaceOf,
} from '../../src/sources/event-ledger.js'
import { REF, foldEvents, searchMetaOf } from './support/source-ledger-arms.js'

describe('the event fold defensive arms', () => {
  it('dates a trail call whose event omits its numeric position at zero', () => {
    const state = foldLedgerEvent(emptyLedgerState(), {
      type: 'tool/call',
      data: { callId: 'c1', name: 'zotero_get', arguments: JSON.stringify({ ref: REF('A1') }) },
    } as never)
    expect(state.pending['c1']).toMatchObject({ seq: 0, time: 0 })
  })

  it('ignores a tool result whose event payload is not an object', () => {
    const initial = emptyLedgerState()
    const next = foldLedgerEvent(initial, {
      type: 'tool/result',
      seq: 1,
      time: 1000,
      data: null,
    } as never)
    expect(next).toBe(initial)
  })

  it('marks a source stopped when its settled result carries an interrupted error', () => {
    const state = foldEvents([
      {
        type: 'tool/call',
        seq: 1,
        time: 1000,
        data: {
          callId: 'c1',
          name: 'zotero_get',
          arguments: JSON.stringify({ ref: REF('AAAA1111') }),
        },
      },
      {
        type: 'tool/result',
        seq: 2,
        time: 2000,
        data: {
          message: { toolCallId: 'c1', content: [{ type: 'text', text: 'partial' }] },
          error: { name: 'ZoteroError', code: 'interrupted', reason: 'cancelled' },
        },
      },
    ])
    expect(factsOf(state)[0]?.error).toEqual({
      name: 'ZoteroError',
      code: 'interrupted',
      reason: 'cancelled',
    })
    expect(workspaceOf(state).sources[0]?.operations).toEqual({
      running: 0,
      failed: 0,
      stopped: 1,
    })
  })

  it('replays a settled item without a presentation projection', () => {
    const state = foldEvents([
      {
        type: 'tool/call',
        seq: 1,
        time: 1000,
        data: {
          callId: 'c1',
          name: 'zotero_get',
          arguments: JSON.stringify({ ref: REF('AAAA1111') }),
        },
      },
      {
        type: 'tool/result',
        seq: 2,
        time: 2000,
        data: { message: { toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } },
      },
    ])
    expect(factsOf(state)[0]).not.toHaveProperty('meta')
    const workspace = workspaceOf(state)
    expect(workspace.sources[0]?.ref).toBe(REF('AAAA1111'))
    expect(workspace.sources[0]?.title).toBeUndefined()
  })

  it('ignores a tool call event missing its argument payload', () => {
    const initial = emptyLedgerState()
    const next = foldLedgerEvent(initial, {
      type: 'tool/call',
      seq: 1,
      time: 1000,
      data: { callId: 'c1', name: 'zotero_get' },
    } as never)
    expect(next).toBe(initial)
  })

  it('ignores a dispatch start for a tool the trail does not record', () => {
    const initial = emptyLedgerState()
    const next = foldLedgerEvent(initial, {
      type: 'tool/ptc-dispatch-start',
      seq: 1,
      time: 1000,
      data: { subCallId: 's1', name: 'zotero_create_note', arguments: { markdown: 'x' } },
    } as never)
    expect(next).toBe(initial)
  })

  it('records a dispatch whose arguments arrived as text', () => {
    const argsRaw = JSON.stringify({ ref: REF('AAAA1111') })
    const started = foldEvents([
      {
        type: 'tool/ptc-dispatch-start',
        seq: 1,
        time: 1000,
        data: { subCallId: 's1', name: 'zotero_get', arguments: argsRaw },
      },
    ])
    expect(started.pending['s1']?.argsRaw).toBe(argsRaw)

    const settled = foldLedgerEvent(started, {
      type: 'tool/ptc-dispatch',
      seq: 2,
      time: 2000,
      data: {
        subCallId: 's1',
        name: 'zotero_get',
        arguments: argsRaw,
        content: [{ type: 'text', text: 'ok' }],
        meta: { title: 'Attention Is All You Need' },
      },
    } as never)
    expect(factsOf(settled)[0]?.argsRaw).toBe(argsRaw)
    expect(workspaceOf(settled).sources[0]?.title).toBe('Attention Is All You Need')
  })

  it('records a dispatch without arguments as an empty payload and no projection', () => {
    const started = foldEvents([
      {
        type: 'tool/ptc-dispatch-start',
        seq: 1,
        time: 1000,
        data: { subCallId: 's1', name: 'zotero_search' },
      },
    ])
    expect(started.pending['s1']?.argsRaw).toBe('{}')

    const settled = foldLedgerEvent(started, {
      type: 'tool/ptc-dispatch',
      seq: 2,
      time: 2000,
      data: {
        subCallId: 's1',
        name: 'zotero_search',
        content: [{ type: 'text', text: 'nothing' }],
      },
    } as never)
    expect(factsOf(settled)[0]?.argsRaw).toBe('{}')
    expect(factsOf(settled)[0]).not.toHaveProperty('meta')
  })

  it('ignores a dispatch outcome without a sub-call identity', () => {
    const initial = emptyLedgerState()
    const next = foldLedgerEvent(initial, {
      type: 'tool/ptc-dispatch',
      seq: 1,
      time: 1000,
      data: { name: 'zotero_get' },
    } as never)
    expect(next).toBe(initial)
  })

  it('records a dispatch whose content is not a block list', () => {
    const state = foldEvents([
      {
        type: 'tool/ptc-dispatch-start',
        seq: 1,
        time: 1000,
        data: { subCallId: 's1', name: 'zotero_get', arguments: { ref: REF('AAAA1111') } },
      },
      {
        type: 'tool/ptc-dispatch',
        seq: 2,
        time: 2000,
        data: {
          subCallId: 's1',
          name: 'zotero_get',
          arguments: { ref: REF('AAAA1111') },
          content: 'not-a-block-list',
          meta: { title: 'Attention Is All You Need' },
        },
      },
    ])
    expect(factsOf(state)[0]?.content).toEqual([])
    expect(workspaceOf(state).sources[0]?.title).toBe('Attention Is All You Need')
  })

  it('marks a dispatched source stopped when the dispatch carries an interrupted error', () => {
    const state = foldEvents([
      {
        type: 'tool/ptc-dispatch-start',
        seq: 1,
        time: 1000,
        data: { subCallId: 's1', name: 'zotero_get', arguments: { ref: REF('AAAA1111') } },
      },
      {
        type: 'tool/ptc-dispatch',
        seq: 2,
        time: 2000,
        data: {
          subCallId: 's1',
          name: 'zotero_get',
          arguments: { ref: REF('AAAA1111') },
          content: [],
          error: { name: 'ZoteroError', code: 'interrupted' },
        },
      },
    ])
    expect(workspaceOf(state).sources[0]?.operations).toEqual({
      running: 0,
      failed: 0,
      stopped: 1,
    })
  })

  it('reports the connected instance verdict for a qualified search row', () => {
    const state = foldEvents([
      {
        type: 'tool/call',
        seq: 1,
        time: 1000,
        data: { callId: 'c1', name: 'zotero_search', arguments: JSON.stringify({ query: 'a' }) },
      },
      {
        type: 'tool/result',
        seq: 2,
        time: 2000,
        data: {
          message: { toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
          meta: searchMetaOf([{ ref: REF('AAAA1111', 'SERVER1'), title: 'Attention' }]),
        },
      },
    ])
    expect(workspaceOf(state, 'SERVER1').sources[0]?.evidenceMatch).toBe('verified')
    expect(workspaceOf(state).sources[0]?.evidenceMatch).toBe('unknown')
  })
})
