/**
 * The SourcesTab module's pure projections, asserted on the functions
 * themselves with no render: the zotero call collector (`collectZoteroCalls`),
 * the status projection with its clock, signature and diagnosis line
 * (`stateOf`, `currentTime`, `sessionSignatureOf`, `connectionDiagnosisOf`),
 * and call naming (`callNameOf`). The rendered faces of the same module are
 * covered by `SourcesTab.states` (mount and assert) and `SourcesTab.interaction`
 * (a scripted probe or filter driven to its output).
 * @module tests/client/SourcesTab.helpers
 */

import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import {
  collectZoteroCalls,
  currentTime,
  sessionSignatureOf,
  stateOf,
} from '../../src/client/components/SourcesTab.tsx'
import { connectionDiagnosisOf } from '../../src/client/components/workspace/connection.ts'
import { callNameOf } from '../../src/client/presenters.ts'
import { zh } from '../../src/client/locales.ts'
import { preparing, running, settled } from './helpers/blocks.ts'
import { CONNECTED, UNAVAILABLE, chatOf, toolRow } from './helpers/sources-tab-harness.tsx'

import { mockT } from './helpers/mock-translate.ts'
const t = mockT

describe('collectZoteroCalls', () => {
  it('collects settled results and in-flight calls, deduped by callId and ordered', () => {
    const result = settled({
      seq: 3,
      callId: 'b',
      call: { name: 'zotero_get', argsRaw: '{}' },
    })
    const snapshot = chatOf([toolRow(result), toolRow(running({ callId: 'a' }))])
    const calls = collectZoteroCalls(snapshot)
    expect(calls.map((call) => call.callId)).toEqual(['b', 'a'])
    expect(collectZoteroCalls(snapshot).map((call) => call.callId)).toEqual(['b', 'a'])
  })

  it('includes nested dispatch and ignores non-zotero calls', () => {
    const nested = settled({
      seq: 4,
      callId: 'nested',
      call: { name: 'zotero_export', argsRaw: '{}' },
    })
    const outer = settled({
      seq: 5,
      callId: 'outer',
      call: { name: 'bash', argsRaw: '{}' },
      subCalls: [nested],
    })
    const calls = collectZoteroCalls(chatOf([toolRow(outer)]))
    expect(calls.map((call) => call.callId)).toEqual(['nested'])
  })

  it('returns an empty list without a chat and skips hidden and non-tool rows', () => {
    expect(collectZoteroCalls(undefined)).toEqual([])
    const assistant = { kind: 'assistant', anchorSeq: 1 } as ChatConversationViewNode
    expect(collectZoteroCalls(chatOf([assistant]))).toEqual([])
    expect(collectZoteroCalls(chatOf([toolRow(settled({ callId: 'h' }), 'hidden')]))).toEqual([])
  })
})

describe('status projection helpers', () => {
  it('projects the settled arms with the acquisition time', () => {
    expect(stateOf({ ok: true, value: CONNECTED }, '10:00:00')).toEqual({
      kind: 'connected',
      data: CONNECTED,
      checkedAt: '10:00:00',
    })
    expect(stateOf({ ok: true, value: UNAVAILABLE }, '10:00:01')).toEqual({
      kind: 'unavailable',
      data: UNAVAILABLE,
      checkedAt: '10:00:01',
    })
    expect(
      stateOf({ ok: false, error: new RemoteError('gateway/internal', 'offline', {}) }, '10:00:02'),
    ).toEqual({ kind: 'remote-error', message: 'offline' })
  })

  it('formats the clock as an absolute HH:MM:SS time', () => {
    expect(currentTime()).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('signs the zotero-relevant snapshot slice with in-flight phase', () => {
    expect(sessionSignatureOf(undefined)).toBe('')
    const signed = sessionSignatureOf(
      chatOf([toolRow(settled({ seq: 3, callId: 'a' })), toolRow(running({ callId: 'b' }))]),
    )
    expect(signed).toBe(
      JSON.stringify({
        order: [
          { callId: 'a', path: ['tool:a'] },
          { callId: 'b', path: ['tool:b'] },
        ],
        running: [{ callId: 'b', phase: 'start' }],
      }),
    )
    // The same content signs identically; streaming publications change
    // neither the visible zotero row order nor the in-flight phase.
    expect(
      sessionSignatureOf(
        chatOf([toolRow(settled({ seq: 3, callId: 'a' })), toolRow(running({ callId: 'b' }))]),
      ),
    ).toBe(signed)
    expect(sessionSignatureOf(chatOf())).toBe(JSON.stringify({ order: [], running: [] }))
    // A hidden row does not count.
    expect(sessionSignatureOf(chatOf([toolRow(settled({ callId: 'h' }), 'hidden')]))).toBe(
      JSON.stringify({ order: [], running: [] }),
    )
    // A non-zotero row does not count either.
    const bashRow = toolRow(settled({ seq: 6, callId: 'n', call: { name: 'bash', argsRaw: '{}' } }))
    expect(sessionSignatureOf(chatOf([toolRow(settled({ seq: 3, callId: 'a' })), bashRow]))).toBe(
      JSON.stringify({ order: [{ callId: 'a', path: ['tool:a'] }], running: [] }),
    )
  })

  it('changes the signature when a call moves preparing → start', () => {
    const before = sessionSignatureOf(chatOf([toolRow(preparing({ callId: 'p' }))]))
    const after = sessionSignatureOf(
      chatOf([toolRow(running({ callId: 'p', argsRaw: '{"q":"x"}' }))]),
    )
    expect(before).not.toBe(after)
    expect(before).toContain('"phase":"preparing"')
    expect(after).toContain('"phase":"start"')
  })

  it('encodes control characters in keys without colliding', () => {
    const tricky = sessionSignatureOf(chatOf([toolRow(settled({ seq: 1, callId: 'a\u0000b' }))]))
    const plain = sessionSignatureOf(chatOf([toolRow(settled({ seq: 1, callId: 'a' }))]))
    expect(tricky).not.toBe(plain)
    expect(JSON.parse(tricky)).toEqual({
      order: [{ callId: 'a\u0000b', path: ['tool:a\u0000b'] }],
      running: [],
    })
  })

  it('keeps structured traversal paths distinct for opaque call ids', () => {
    const first = toolRow(
      settled({
        seq: 1,
        callId: 'a',
        call: { name: 'agent_call', argsRaw: '{}' },
        subCalls: [settled({ seq: 2, callId: 'b/c', call: { name: 'zotero_get', argsRaw: '{}' } })],
      }),
    )
    const second = toolRow(
      settled({
        seq: 1,
        callId: 'a/b',
        call: { name: 'agent_call', argsRaw: '{}' },
        subCalls: [settled({ seq: 2, callId: 'c', call: { name: 'zotero_get', argsRaw: '{}' } })],
      }),
    )
    expect(sessionSignatureOf(chatOf([first]))).not.toBe(sessionSignatureOf(chatOf([second])))
  })

  it('recursively signs nested subCalls for PTC mode', () => {
    const nestedSettled = settled({
      seq: 4,
      callId: 'nested-zot',
      call: { name: 'zotero_get', argsRaw: '{}' },
    })
    const nestedRunning = running({
      callId: 'nested-run',
      name: 'zotero_search',
      argsRaw: '{}',
    })
    const outer = settled({
      seq: 5,
      callId: 'outer-agent',
      call: { name: 'agent_call', argsRaw: '{}' },
      subCalls: [nestedSettled, nestedRunning],
    })
    const signed = sessionSignatureOf(chatOf([toolRow(outer)]))
    const parsed = JSON.parse(signed) as {
      order: Array<{ callId: string; path: string[] }>
      running: Array<{ callId: string; phase: string }>
    }
    expect(parsed.order).toContainEqual({
      callId: 'nested-zot',
      path: ['tool:outer-agent', 'nested-zot'],
    })
    expect(parsed.order).toContainEqual({
      callId: 'nested-run',
      path: ['tool:outer-agent', 'nested-run'],
    })
    expect(parsed.running).toEqual([{ callId: 'nested-run', phase: 'start' }])
  })

  it('collects in presentation order even when values disagree', () => {
    const first = toolRow(settled({ seq: 1, callId: 'first' }))
    const second = toolRow(settled({ seq: 2, callId: 'second' }))
    const chat = chatOf([first, second])
    // `values()` deliberately disagrees with `order` here: the collector must
    // follow `order`, the harness presentation order.
    const nodes = chat.nodes as unknown as {
      get: (key: string) => unknown
      values: () => unknown[]
    }
    const reversed = [second, first]
    ;(nodes as { values: () => unknown[] }).values = () => reversed
    expect(collectZoteroCalls(chat).map((block) => block.callId)).toEqual(['first', 'second'])
  })

  it('ignores stale order keys without crashing', () => {
    const chat = chatOf([toolRow(settled({ seq: 1, callId: 'a' }))])
    const withStale: ChatSnapshot = { ...chat, order: [...chat.order, 'stale-key'] }
    expect(() => collectZoteroCalls(withStale)).not.toThrow()
    expect(collectZoteroCalls(withStale)).toHaveLength(1)
    expect(sessionSignatureOf(withStale)).toBe(
      JSON.stringify({ order: [{ callId: 'a', path: ['tool:a'] }], running: [] }),
    )
  })

  it('builds the failure diagnosis line', () => {
    expect(connectionDiagnosisOf({ kind: 'remote-error', message: 'gateway offline' }, t)).toBe(
      '诊断: gateway offline',
    )
    expect(
      connectionDiagnosisOf({ kind: 'unavailable', data: UNAVAILABLE, checkedAt: '10:00:00' }, t),
    ).toBe('诊断: connection refused')
    expect(
      connectionDiagnosisOf(
        {
          kind: 'unavailable',
          data: { providerId: 'local', connected: false, diagnosis: '' },
          checkedAt: '10:00:00',
        },
        t,
      ),
    ).toBe(zh.statusUnavailable)
    expect(connectionDiagnosisOf({ kind: 'loading' }, t)).toBe('')
  })

  it('names calls from both block forms', () => {
    expect(callNameOf(running())).toBe('zotero_search')
    expect(callNameOf(settled())).toBe('zotero_search')
    expect(callNameOf(settled({ call: null }))).toBeNull()
  })
})
