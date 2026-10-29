/**
 * The diagnostics endpoints over the composed host: the ring the service
 * keeps, what a failing tool contributes to it, what the client-error intake
 * stores, and the debug threshold the `debug` config flag gates.
 * @module tests/host/diagnostics
 */

import { afterEach, describe, expect, it } from 'vitest'
import { ZOTERO_NOT_RUNNING, ZOTERO_UNEXPECTED, ZoteroError } from '../../src/errors.js'
import { ZoteroRuntime } from '../../src/remote.js'
import {
  commitLive,
  expectValue,
  type HostLane,
  setupHostLane,
} from '../helpers/lanes/host-lane.js'

/** The lane the current test booted; `afterEach` releases it. */
let lane: HostLane | undefined

/** A signal that never aborts: direct Remote calls pass the carrier signal the gateway would inject. */
const LIVE_SIGNAL = new AbortController().signal

afterEach(async () => {
  await lane?.ctx.fiber.dispose()
  await lane?.teardown()
  lane = undefined
})

function runtimeOf(l: HostLane): ZoteroRuntime {
  return l.ctx.get('zoteroRemote') as ZoteroRuntime
}

describe('the zotero diagnostics endpoint', () => {
  it('serves the snapshot with the debug fact and the built transport', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    expect(view.debug).toBe(false)
    expect(view.truncated).toBe(false)
    expect(view.total).toBeGreaterThanOrEqual(1)
    expect(view.entries[0]).toMatchObject({ event: 'transport.built', level: 'info', count: 1 })
  })

  it('records a failing tool call with its transport failure beneath it', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    lane.mock.route('GET', /\/api\/users\/0\/items/, (_req, _res, helpers) =>
      helpers.raw(500, { 'Content-Type': 'application/json' }, 'no'),
    )
    const result = await lane.runTool('zotero_search', { query: 'flash attention', limit: 5 })
    expect(result.isError).toBe(true)
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const toolResult = view.entries.find((entry) => entry.event === 'tool.result')
    const httpFailure = view.entries.find((entry) => entry.event === 'http.failure')
    expect(toolResult).toMatchObject({
      level: 'warn',
      // The folded ZoteroError's stable code rides the detail, the same grep
      // anchor the transport failure line beneath it carries.
      detail: { errorCode: ZOTERO_UNEXPECTED },
      // Newest-first: the tool outcome sits above the transport line.
    })
    expect(toolResult?.message).toContain('zotero_search failed')
    expect(httpFailure).toMatchObject({ level: 'error' })
    expect(httpFailure?.message).toContain('GET ')
    // The failure entries predate the tool outcome in sequence order.
    expect(toolResult?.seq ?? 0).toBeGreaterThan(httpFailure?.seq ?? 0)
    // The tool's argument digest rode the debug ring only; at the default
    // threshold no `tool.call` line is retained.
    expect(view.entries.every((entry) => entry.event !== 'tool.call')).toBe(true)
  })

  it('records a failed tool result without an error code when the fold carried none', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    // A result the registry would hand back with no `error.info` (a plain
    // throw folded without a HarnessError code): the warn still lands, and
    // the detail carries the timing alone.
    const exec = {
      callId: 'diag-call-3' as never,
      name: 'zotero_search',
      arguments: undefined,
      signal: new AbortController().signal,
    }
    await lane.zoteroFiber.ctx.waterfall(
      lane.zoteroFiber as never,
      'tools/execute',
      exec as never,
      () =>
        Promise.resolve({
          isError: true,
          error: { message: 'plain refusal' },
          content: [{ type: 'text', text: 'Error: plain refusal' }],
        }) as never,
    )
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const entry = view.entries.find((candidate) => candidate.message.includes('plain refusal'))
    expect(entry).toMatchObject({ level: 'warn', event: 'tool.result' })
    expect(entry?.detail?.errorCode).toBeUndefined()
  })

  it('keeps debug entries out until the config flag flips', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    lane.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (_req, _res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
    expectValue(
      await lane.runTool('zotero_search', { query: 'quiet run', limit: 5 }),
      'zotero_search',
    )
    const quiet = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    expect(quiet.debug).toBe(false)
    expect(quiet.entries.every((entry) => entry.event !== 'http.request')).toBe(true)

    await commitLive(lane, { debug: true })
    expectValue(
      await lane.runTool('zotero_search', { query: 'verbose run', limit: 5 }),
      'zotero_search',
    )
    const verbose = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    expect(verbose.debug).toBe(true)
    expect(verbose.entries.some((entry) => entry.event === 'http.request')).toBe(true)
    expect(verbose.entries.some((entry) => entry.event === 'tool.call')).toBe(true)
    expect(verbose.entries.some((entry) => entry.event === 'tool.result')).toBe(true)
  })

  it('formats tool call digest for debug entries with long or circular arguments', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    await commitLive(lane, { debug: true })

    // Long arguments (>300 chars)
    const longQuery = 'q'.repeat(400)
    lane.mock.route('GET', /^\/api\/users\/0\/items(\/top)?$/, (_req, _res, helpers) =>
      helpers.json([], { 'Total-Results': '0' }),
    )
    await lane.runTool('zotero_search', { query: longQuery, limit: 5 })

    // Circular arguments (JSON.stringify throws)
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const execCircular = {
      callId: 'diag-circular-1' as never,
      name: 'zotero_search',
      arguments: circular,
      signal: new AbortController().signal,
    }
    await lane.zoteroFiber.ctx.waterfall(
      lane.zoteroFiber as never,
      'tools/execute',
      execCircular as never,
      () => Promise.resolve({ isError: false, content: [] }) as never,
    )

    // Undefined arguments
    const execEmpty = {
      callId: 'diag-empty-1' as never,
      name: 'zotero_search',
      arguments: undefined,
      signal: new AbortController().signal,
    }
    await lane.zoteroFiber.ctx.waterfall(
      lane.zoteroFiber as never,
      'tools/execute',
      execEmpty as never,
      () => Promise.resolve({ isError: false, content: [] }) as never,
    )

    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const callEntries = view.entries.filter((entry) => entry.event === 'tool.call')
    const longCall = callEntries.find((entry) => entry.message.includes('…'))
    expect(longCall).toBeDefined()
    expect(longCall?.message.endsWith('…')).toBe(true)

    const bareCalls = callEntries.filter((entry) => entry.message === 'zotero_search')
    expect(bareCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('accepts a client error report, clamped, and assigns its sequence', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const receipt = await runtimeOf(lane).reportClientError(
      {
        surface: 'sources',
        message: 'x'.repeat(2000),
        stack: 's'.repeat(5000),
        componentStack: 'c'.repeat(3000),
      },
      LIVE_SIGNAL,
    )
    expect(receipt.seq).toBeGreaterThan(0)
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const entry = view.entries.find((candidate) => candidate.event === 'client.render')
    expect(entry).toMatchObject({ level: 'error', seq: receipt.seq })
    expect(entry?.message.startsWith('sources: ')).toBe(true)
    expect(entry?.message.length).toBeLessThanOrEqual(510)
    expect(entry?.detail?.stack).toHaveLength(1000)
    expect(entry?.detail?.componentStack).toHaveLength(1000)
  })
  it('captures subtree logger messages through the exporter tap', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    // An unnamed logger access inside the plugin's fiber reaches the exporter
    // under the fiber-derived `zotero-service` name, so it files as a
    // lifecycle entry with the stable error code.
    lane.zoteroFiber.ctx.logger.error(new ZoteroError('the library is closed', ZOTERO_NOT_RUNNING))
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const entry = view.entries.find((candidate) => candidate.event === 'lifecycle')
    expect(entry).toMatchObject({
      level: 'error',
      detail: { errorCode: ZOTERO_NOT_RUNNING, logger: 'zotero-service' },
    })
  })

  it('ignores logger messages from outside the plugin subtree', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    // A root-context logger carries no plugin name: the exporter must leave
    // it for the harness's own (unmounted) sinks.
    lane.ctx.logger.warn('a root-level note')
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    expect(view.entries.every((candidate) => candidate.event !== 'lifecycle')).toBe(true)
  })

  it('records a probe transition only when connectivity actually flips', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    lane.mock.route('GET', '/api/', (_req, _res, helpers) =>
      helpers.json({}, { 'Zotero-Server-ID': 'S1' }),
    )
    const service = lane.ctx.get('zotero')
    await service!.status()
    await service!.status()
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const entries = view.entries.filter((candidate) => candidate.event === 'probe.changed')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ level: 'info', message: 'Zotero connected' })
  })

  it('booted with the debug flag retains debug entries from the start', async () => {
    lane = await setupHostLane({ debug: true }, { typert: true })
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    expect(view.debug).toBe(true)
  })

  it('leaves a config commit carried by a foreign scope untouched', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    // A waterfall carried by a foreign scope object fails the fiber identity
    // check and passes through unvetoed.
    const raw = { timeoutMs: 42 }
    expect(
      lane.zoteroFiber.ctx.waterfall(lane.ctx as never, 'internal/config', raw, () => raw),
    ).toBe(raw)
  })

  it('records a registry-level tool throw and digests hostile arguments', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    // Cyclic arguments: the digest must degrade to a string, never throw.
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const exec = {
      callId: 'diag-call' as never,
      name: 'zotero_search',
      arguments: cyclic,
      signal: new AbortController().signal,
    }
    await expect(
      lane.zoteroFiber.ctx.waterfall(
        lane.zoteroFiber as never,
        'tools/execute',
        exec as never,
        () => Promise.reject(new Error('registry blew up')),
      ),
    ).rejects.toThrow('registry blew up')
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const entry = view.entries.find((candidate) => candidate.event === 'tool.result')
    expect(entry).toMatchObject({ level: 'error' })
    expect(entry?.message).toContain('zotero_search threw: registry blew up')

    // A non-Error rejection renders through its string form, and absent
    // arguments digest to the bare tool name.
    const bare = {
      callId: 'diag-call-2' as never,
      name: 'zotero_search',
      arguments: undefined,
      signal: new AbortController().signal,
    }
    await expect(
      lane.zoteroFiber.ctx.waterfall(
        lane.zoteroFiber as never,
        'tools/execute',
        bare as never,
        () => Promise.reject('bare string failure'),
      ),
    ).rejects.toBe('bare string failure')
    const refreshed = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    const bareEntry = refreshed.entries.find((candidate) =>
      candidate.message.includes('bare string failure'),
    )
    expect(bareEntry?.message).toContain('zotero_search threw: bare string failure')
  })

  it('rebuilds the transport from live commits and ignores heavy-tool flag flips', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const before = (await runtimeOf(lane).diagnostics(LIVE_SIGNAL)).entries.find(
      (candidate) => candidate.event === 'transport.built',
    )
    await commitLive(lane, { timeoutMs: 12345 })
    await commitLive(lane, { enableRunInBackground: false })
    await commitLive(lane, { enableRunInBackground: true })
    // A transport-key commit carrying the current value rebuilds nothing.
    await commitLive(lane, { timeoutMs: 12345 })
    const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
    // Identical consecutive builds coalesce into a count bump; the heavy-tool
    // flag flips are not transport keys (the tools read them per request) and
    // the no-op commit must not have touched the transport count.
    const entry = view.entries.find((candidate) => candidate.event === 'transport.built')
    expect(entry?.count).toBe((before?.count ?? 0) + 1)
  })

  it('records a failed transport rebuild instead of throwing into the dispatch', async () => {
    lane = await setupHostLane(undefined, { typert: true })
    const service = lane.ctx.get('zotero')
    const original = service!['buildTransport'].bind(service)
    service!['buildTransport'] = () => {
      throw new Error('rebuild exploded')
    }
    try {
      await commitLive(lane, { timeoutMs: 999 })
      const view = await runtimeOf(lane).diagnostics(LIVE_SIGNAL)
      const entry = view.entries.find((candidate) => candidate.event === 'config.apply.failed')
      expect(entry).toMatchObject({ level: 'error' })
      expect(entry?.message).toContain('rebuild exploded')
    } finally {
      service!['buildTransport'] = original
    }
  })
})
