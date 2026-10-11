/**
 * Unit tests for `src/diagnostics.ts` (the diagnostics ring and recorder).
 * @module tests/unit/diagnostics
 */

import { describe, expect, it } from 'vitest'
import {
  DIAGNOSTIC_LOG_PREFIX,
  DiagnosticsRecorder,
  DiagnosticsRing,
  logMessageToPush,
  loggerNameMatches,
} from '../../src/diagnostics.js'

function codedError(message: string, code: string): Error {
  const error: Error & { code?: string } = new Error(message)
  error.code = code
  return error
}

describe('loggerNameMatches', () => {
  it('accepts the bare plugin root and its dotted children', () => {
    expect(loggerNameMatches('zotero')).toBe(true)
    expect(loggerNameMatches('zotero.http')).toBe(true)
    expect(loggerNameMatches('zotero.write.batch')).toBe(true)
  })

  it('accepts the hyphenated fiber-derived name lifecycle failures log under', () => {
    expect(loggerNameMatches('zotero-service')).toBe(true)
    expect(loggerNameMatches('zotero-remote')).toBe(true)
  })

  it('rejects names outside the plugin subtree', () => {
    expect(loggerNameMatches('dsh-zotero')).toBe(false)
    expect(loggerNameMatches('zoteroish')).toBe(false)
    expect(loggerNameMatches('gateway')).toBe(false)
    expect(loggerNameMatches('')).toBe(false)
  })

  it('anchors the prefix on the exported constant', () => {
    expect(loggerNameMatches(`${DIAGNOSTIC_LOG_PREFIX}.x`)).toBe(true)
  })
})

describe('logMessageToPush', () => {
  it('maps known logger types onto levels and unknown types onto info', () => {
    expect(logMessageToPush({ name: 'zotero', type: 'warn', args: ['w'] }).level).toBe('warn')
    expect(logMessageToPush({ name: 'zotero', type: 'debug', args: ['d'] }).level).toBe('debug')
    expect(logMessageToPush({ name: 'zotero', type: 'error', args: ['e'] }).level).toBe('error')
    expect(logMessageToPush({ name: 'zotero', type: 'info', args: ['i'] }).level).toBe('info')
    expect(logMessageToPush({ name: 'zotero', type: 'verbose', args: ['v'] }).level).toBe('info')
  })

  it('takes the message from a leading string argument', () => {
    const push = logMessageToPush({ name: 'zotero', type: 'error', args: ['boom'] })
    expect(push.message).toBe('boom')
    expect(push.event).toBe('lifecycle')
    expect(push.detail).toBeUndefined()
  })

  it('renders a leading Error with its code', () => {
    const push = logMessageToPush({
      name: 'zotero',
      type: 'error',
      args: [codedError('the library is closed', 'ZOTERO_NOT_RUNNING')],
    })
    expect(push.message).toBe('Error: the library is closed')
    expect(push.detail).toMatchObject({ errorCode: 'ZOTERO_NOT_RUNNING' })
  })

  it('serializes a leading non-string argument', () => {
    const push = logMessageToPush({ name: 'zotero', type: 'info', args: [{ attempts: 2 }] })
    expect(push.message).toBe('{"attempts":2}')
  })

  it('keeps an empty message when no arguments arrive', () => {
    expect(logMessageToPush({ name: 'zotero', type: 'info', args: [] }).message).toBe('')
  })

  it('records further arguments as argN details', () => {
    const push = logMessageToPush({
      name: 'zotero',
      type: 'error',
      args: ['failed', codedError('cause', 'E_CAUSE'), 'aftermath', 7],
    })
    expect(push.detail).toMatchObject({
      arg1: 'Error: cause',
      arg2: 'aftermath',
      arg3: 7,
    })
  })

  it('serializes a plain-object argument into its detail', () => {
    const push = logMessageToPush({
      name: 'zotero',
      type: 'warn',
      args: ['degraded', { attempts: 2, live: true }],
    })
    expect(push.detail).toMatchObject({ arg1: '{"attempts":2,"live":true}' })
  })

  it('stringifies arguments JSON cannot represent', () => {
    const push = logMessageToPush({
      name: 'zotero',
      type: 'info',
      args: ['tick', undefined, () => 'noop'],
    })
    expect(push.detail).toMatchObject({ arg1: 'undefined' })
    expect(typeof push.detail?.arg2).toBe('string')
  })

  it('omits the errorCode detail for an empty-string code', () => {
    const push = logMessageToPush({
      name: 'zotero',
      type: 'error',
      args: [codedError('uncoded', '')],
    })
    expect(push.message).toBe('Error: uncoded')
    expect(push.detail).toBeUndefined()
  })

  it('degrades a cyclic argument to its string form instead of throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const push = logMessageToPush({ name: 'zotero', type: 'info', args: [cyclic] })
    expect(typeof push.message).toBe('string')
    expect(push.message).not.toBe('')
  })

  it('carries a specific logger name in the detail', () => {
    const push = logMessageToPush({ name: 'zotero.jobs', type: 'info', args: ['tick'] })
    expect(push.detail).toMatchObject({ logger: 'zotero.jobs' })
  })

  it('omits the logger detail for the bare plugin root', () => {
    const push = logMessageToPush({ name: 'zotero', type: 'info', args: ['tick'] })
    expect(push.detail).toBeUndefined()
  })
})

describe('DiagnosticsRing', () => {
  it('stamps monotonic sequence numbers and serves newest-first', () => {
    const ring = new DiagnosticsRing()
    const first = ring.push({ level: 'info', event: 'a', message: 'one' })
    const second = ring.push({ level: 'warn', event: 'b', message: 'two' })
    expect(second).toBe(first + 1)
    const snapshot = ring.snapshot()
    expect(snapshot.entries.map((entry) => entry.seq)).toEqual([second, first])
    expect(snapshot.total).toBe(2)
    expect(snapshot.truncated).toBe(false)
  })

  it('coalesces a consecutive repeat into a count bump on the same entry', () => {
    const ring = new DiagnosticsRing()
    const seq = ring.push({
      level: 'error',
      event: 'tool.result',
      message: 'boom',
      detail: { at: 1 },
    })
    ring.push({ level: 'error', event: 'tool.result', message: 'boom' })
    ring.push({ level: 'error', event: 'tool.result', message: 'boom' })
    const snapshot = ring.snapshot()
    expect(snapshot.entries).toHaveLength(1)
    expect(snapshot.entries[0]).toMatchObject({ seq, count: 3, event: 'tool.result' })
  })

  it('keeps separate entries for identical text separated by another event', () => {
    const ring = new DiagnosticsRing()
    ring.push({ level: 'error', event: 'a', message: 'boom' })
    ring.push({ level: 'warn', event: 'a', message: 'boom' })
    ring.push({ level: 'error', event: 'a', message: 'boom' })
    expect(ring.snapshot().entries).toHaveLength(3)
  })

  it('evicts the oldest past capacity', () => {
    const ring = new DiagnosticsRing(3)
    for (const index of [1, 2, 3, 4]) {
      ring.push({ level: 'info', event: 'e', message: `m${index}` })
    }
    const snapshot = ring.snapshot()
    expect(snapshot.total).toBe(3)
    expect(snapshot.entries.map((entry) => entry.message)).toEqual(['m4', 'm3', 'm2'])
  })

  it('clamps an oversized message with an ellipsis', () => {
    const ring = new DiagnosticsRing()
    ring.push({ level: 'info', event: 'e', message: 'x'.repeat(600) })
    const message = ring.snapshot().entries[0].message
    expect(message).toHaveLength(500)
    expect(message.endsWith('…')).toBe(true)
  })

  it('clamps detail to eight fields and bounded string values', () => {
    const ring = new DiagnosticsRing()
    const detail: Record<string, string | number | boolean> = {}
    for (let index = 0; index < 12; index += 1) {
      detail[`k${index}`] = index
    }
    detail.k0 = 'y'.repeat(2000)
    ring.push({ level: 'info', event: 'e', message: 'm', detail })
    const stored = ring.snapshot().entries[0].detail
    expect(Object.keys(stored ?? {})).toHaveLength(8)
    expect(stored?.k0).toHaveLength(1000)
  })

  it('reports truncation against the requested limit', () => {
    const ring = new DiagnosticsRing()
    for (let index = 0; index < 5; index += 1) {
      ring.push({ level: 'info', event: 'e', message: `m${index}` })
    }
    const snapshot = ring.snapshot(2)
    expect(snapshot.total).toBe(5)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.entries).toHaveLength(2)
  })
})

describe('DiagnosticsRecorder', () => {
  it('retains info and above by default and drops debug', () => {
    const recorder = new DiagnosticsRecorder()
    recorder.sink.debug('d.e', 'detail')
    recorder.sink.info('i.e', 'transition')
    recorder.sink.warn('w.e', 'degraded')
    recorder.sink.error('e.e', 'failed')
    const events = recorder.snapshot().entries.map((entry) => entry.event)
    expect(events).toEqual(['e.e', 'w.e', 'i.e'])
  })

  it('retains detail values handed to the sink', () => {
    const recorder = new DiagnosticsRecorder()
    recorder.sink.warn('degraded.unobservable', 'kind contributed nothing', {
      kind: 'trashed',
      reason: 'not-served',
    })
    const stored = recorder.snapshot().entries[0]
    expect(stored.detail).toMatchObject({ kind: 'trashed', reason: 'not-served' })
  })

  it('admits debug once the threshold lowers', () => {
    const recorder = new DiagnosticsRecorder()
    recorder.setThreshold('debug')
    recorder.sink.debug('d.e', 'detail')
    expect(recorder.snapshot().entries.map((entry) => entry.event)).toEqual(['d.e'])
  })

  it('keeps only errors once the threshold raises', () => {
    const recorder = new DiagnosticsRecorder()
    recorder.setThreshold('error')
    recorder.sink.info('i.e', 'transition')
    recorder.sink.warn('w.e', 'degraded')
    recorder.sink.error('e.e', 'failed')
    expect(recorder.snapshot().entries.map((entry) => entry.event)).toEqual(['e.e'])
  })

  it('hands out one stable sink', () => {
    const recorder = new DiagnosticsRecorder()
    expect(recorder.sink).toBe(recorder.sink)
  })

  it('pushes bypass the threshold for the exporter and client-error paths', () => {
    const recorder = new DiagnosticsRecorder()
    const seq = recorder.push({ level: 'debug', event: 'client.render', message: 'crash' })
    expect(seq).toBeGreaterThan(0)
    expect(recorder.snapshot().entries.map((entry) => entry.event)).toEqual(['client.render'])
  })

  it('evicts at the configured capacity', () => {
    const recorder = new DiagnosticsRecorder(2)
    recorder.sink.info('a', '1')
    recorder.sink.info('a', '2')
    recorder.sink.info('a', '3')
    const snapshot = recorder.snapshot()
    expect(snapshot.total).toBe(2)
    expect(snapshot.entries.map((entry) => entry.message)).toEqual(['3', '2'])
  })

  it('reports admission against the live threshold', () => {
    const recorder = new DiagnosticsRecorder()
    expect(recorder.admits('error')).toBe(true)
    expect(recorder.admits('info')).toBe(true)
    expect(recorder.admits('debug')).toBe(false)
    recorder.setThreshold('debug')
    expect(recorder.admits('debug')).toBe(true)
    recorder.setThreshold('error')
    expect(recorder.admits('warn')).toBe(false)
    expect(recorder.admits('error')).toBe(true)
  })
})
