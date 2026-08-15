/**
 * The Remote scope: a live `SettingsScope` over the zotero Typert namespace —
 * starts loading, publishes the first view after `connect()`, writes go out
 * with the last known revision, and a refused write reloads the Host view
 * instead of resolving (which is what makes the form's read-back report it).
 * @module tests/client/remote-scope
 */

import { describe, expect, it } from 'vitest'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteScope, type ZoteroRemoteFace } from '../../src/client/remote-scope.ts'
import type { ZoteroConfigView } from '../../src/client/remote.ts'

const VIEW: ZoteroConfigView = {
  available: true,
  writable: true,
  value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 },
  base: { baseUrl: 'http://127.0.0.1:23119/api' },
  user: undefined,
  revision: 3,
}

function ok(view: ZoteroConfigView): { ok: true; value: ZoteroConfigView } {
  return { ok: true, value: view }
}

function fail(message: string): { ok: false; error: RemoteFailure } {
  return { ok: false, error: { code: 'x', message, details: {} } }
}

/** A scripted Remote face recording every call. */
function fakeFace(script: Array<() => RemoteResult<ZoteroConfigView>>): {
  face: ZoteroRemoteFace
  calls: string[]
} {
  const calls: string[] = []
  let step = 0
  const run = (): RemoteResult<ZoteroConfigView> => script[step++]()
  const face: ZoteroRemoteFace = {
    status: async () => ({
      ok: true,
      value: { providerId: 'local', connected: true, diagnosis: 'ok' },
    }),
    config: async () => {
      calls.push('config')
      return run()
    },
    configUpdate: async (patch, revision) => {
      calls.push(`configUpdate:${JSON.stringify(patch)}@${revision}`)
      return run()
    },
    configClear: async (field, revision) => {
      calls.push(`configClear:${field}@${revision}`)
      return run()
    },
  }
  return { face, calls }
}

describe('RemoteScope', () => {
  it('starts loading and publishes the first view on connect', async () => {
    const { face } = fakeFace([() => ok(VIEW)])
    const scope = new RemoteScope(() => face)
    expect(scope.getSnapshot().status).toBe('loading')
    await scope.connect()
    expect(scope.getSnapshot().status).toBe('ready')
    expect(scope.getSnapshot().value).toMatchObject({ baseUrl: 'http://127.0.0.1:23119/api' })
    expect(scope.getSnapshot().revision).toBe(3)
  })

  it('is idempotent across repeated connect calls', async () => {
    const { face, calls } = fakeFace([() => ok(VIEW)])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    await scope.connect()
    // One load: the second connect short-circuits on the settled flag.
    expect(calls).toEqual(['config'])
  })

  it('notifies subscribers on the first view', async () => {
    const { face } = fakeFace([() => ok(VIEW)])
    const scope = new RemoteScope(() => face)
    let seen = 0
    scope.subscribe(() => {
      seen += 1
    })
    await scope.connect()
    expect(seen).toBe(1)
  })

  it('stops notifying a subscriber after its disposer runs', async () => {
    const { face } = fakeFace([() => ok(VIEW), () => ok({ ...VIEW, revision: 4 })])
    const scope = new RemoteScope(() => face)
    let seen = 0
    const off = scope.subscribe(() => {
      seen += 1
    })
    await scope.connect()
    expect(seen).toBe(1)
    off()
    await scope.set('timeoutMs', 7000)
    expect(seen).toBe(1)
  })

  it('merges a field write with the last known revision and applies the reply', async () => {
    const next = {
      ...VIEW,
      user: { timeoutMs: 7000 },
      value: { ...VIEW.value, timeoutMs: 7000 },
      revision: 4,
    }
    const { face, calls } = fakeFace([() => ok(VIEW), () => ok(next)])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    await scope.set('timeoutMs', 7000)
    expect(calls[1]).toBe('configUpdate:{"timeoutMs":7000}@3')
    expect(scope.getSnapshot().user).toEqual({ timeoutMs: 7000 })
    expect(scope.getSnapshot().revision).toBe(4)
  })

  it('clears a field through the clear endpoint', async () => {
    const next = { ...VIEW, user: undefined, revision: 5 }
    const { face, calls } = fakeFace([() => ok(VIEW), () => ok(next)])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    await scope.unset('timeoutMs')
    expect(calls[1]).toBe('configClear:timeoutMs@3')
    expect(scope.getSnapshot().user).toBeUndefined()
  })

  it('reloads the Host view when a clear is refused', async () => {
    const { face } = fakeFace([() => ok(VIEW), () => fail('rejected'), () => ok(VIEW)])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    await scope.unset('timeoutMs')
    // The refused clear reloaded rather than landing: user layer unchanged.
    expect(scope.getSnapshot().user).toBeUndefined()
    expect(scope.getSnapshot().value).toMatchObject({ timeoutMs: 5000 })
  })

  it('reloads the Host view when a write is refused', async () => {
    const { face } = fakeFace([() => ok(VIEW), () => fail('rejected'), () => ok(VIEW)])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    await scope.set('timeoutMs', 9999)
    // The refused write reloaded rather than landing: user layer unchanged.
    expect(scope.getSnapshot().user).toBeUndefined()
    expect(scope.getSnapshot().value).toMatchObject({ timeoutMs: 5000 })
  })

  it('is a no-op while the Remote face is not mounted', async () => {
    const { face, calls } = fakeFace([() => ok(VIEW)])
    const scope = new RemoteScope(() => undefined)
    await scope.connect()
    await scope.set('timeoutMs', 7000)
    await scope.unset('timeoutMs')
    expect(calls).toEqual([])
    expect(scope.getSnapshot().status).toBe('loading')
  })

  it('maps an unavailable view onto the unavailable status', async () => {
    const { face } = fakeFace([() => ok({ ...VIEW, available: false, writable: false })])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    expect(scope.getSnapshot().status).toBe('unavailable')
    expect(scope.getSnapshot().writable).toBe(false)
  })

  it('keeps the last snapshot when the first load fails', async () => {
    const { face } = fakeFace([() => fail('network')])
    const scope = new RemoteScope(() => face)
    await scope.connect()
    expect(scope.getSnapshot().status).toBe('loading')
  })
})
