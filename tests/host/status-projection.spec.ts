/**
 * The `zoteroStatus` projection unit: what it folds, and what it refuses.
 *
 * The unit is pure, so the spec drives `init`/`apply`/`wire.view` directly
 * instead of standing up a registry and a Session: the properties that matter
 * are "a status event replaces the previous view", "any other event returns the
 * same reference" (the registry's `Object.is` gate depends on it), and "the wire
 * view is the folded value".
 * @module tests/host/status-projection
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { toStatusView } from '../../src/session-events.js'
import { ZOTERO_STATUS_PROJECTION } from '../../src/status-projection.js'
import type { ZoteroStatusView } from '../../src/contract.js'
import type { ZoteroStatus } from '../../src/types.js'

/** One `zotero/status` event as the command handler appends it. */
function statusEvent(status: ZoteroStatusView, seq = 3): SessionEvent {
  return {
    type: 'zotero/status',
    seq: seq as SessionSeq,
    time: 1_700_000_000_000,
    data: { version: 1, status },
  } as SessionEvent
}

/** A session event the projection does not own. */
function foreignEvent(seq = 4): SessionEvent {
  return {
    type: 'turn/start',
    seq: seq as SessionSeq,
    time: 1_700_000_000_000,
    data: { turn: 1 },
  } as SessionEvent
}

const CONNECTED: ZoteroStatusView = {
  providerId: 'local',
  endpoint: '127.0.0.1:23119',
  connected: true,
  zoteroVersion: '7.0.11',
  apiVersion: '3',
  schemaVersion: '1',
  serverId: '0123456789abcdef',
  write: { enabled: true, authorized: true },
}

describe('zoteroStatus projection', () => {
  it('starts with nothing probed in this session', () => {
    const initial = ZOTERO_STATUS_PROJECTION.init({} as never, 0 as never)
    expect(initial).toBeNull()
  })

  it('replaces the previous view with the newest status event', () => {
    const first = ZOTERO_STATUS_PROJECTION.apply(
      ZOTERO_STATUS_PROJECTION.init({} as never, 0 as never),
      statusEvent({ providerId: 'local', connected: false, diagnosis: 'ZOTERO_NOT_RUNNING' }),
    )
    expect(first?.connected).toBe(false)

    const second = ZOTERO_STATUS_PROJECTION.apply(first, statusEvent(CONNECTED))
    expect(second).toEqual(CONNECTED)
    // A last-value fold: the older probe is not retained.
    expect(second?.diagnosis).toBeUndefined()
  })

  it('returns the same reference for an event it does not own', () => {
    const state = ZOTERO_STATUS_PROJECTION.apply(
      ZOTERO_STATUS_PROJECTION.init({} as never, 0 as never),
      statusEvent(CONNECTED),
    )
    // The registry suppresses downstream work when the fold reference holds.
    expect(ZOTERO_STATUS_PROJECTION.apply(state, foreignEvent())).toBe(state)
  })

  it('projects the folded value as the wire value', () => {
    const state = ZOTERO_STATUS_PROJECTION.apply(
      ZOTERO_STATUS_PROJECTION.init({} as never, 0 as never),
      statusEvent(CONNECTED),
    )
    expect(ZOTERO_STATUS_PROJECTION.wire.view(state)).toBe(state)
    expect(ZOTERO_STATUS_PROJECTION.wire.viewSchema.parse(state)).toEqual(CONNECTED)
  })

  it('keeps absent optional facts absent through the wire schema', () => {
    const minimal: ZoteroStatusView = {
      providerId: 'local',
      connected: false,
      diagnosis: 'offline',
    }
    const parsed = ZOTERO_STATUS_PROJECTION.wire.viewSchema.parse(minimal) as ZoteroStatusView
    expect(parsed).toEqual(minimal)
    expect('endpoint' in parsed).toBe(false)
  })

  it('pins its stateVersion so a persisted row from an older fold is discarded', () => {
    // Bumping this without a migration would forward-apply stale rows.
    expect(ZOTERO_STATUS_PROJECTION.stateVersion).toBe(1)
  })
})

describe('toStatusView', () => {
  const base: ZoteroStatus = {
    providerId: 'local',
    endpoint: '127.0.0.1:23119',
    connected: true,
    diagnosis: 'ok',
  }

  it('strips the connected-probe sentinel so no diagnosis box renders', () => {
    expect('diagnosis' in toStatusView(base)).toBe(false)
  })

  it('keeps a real diagnosis on the disconnected arm', () => {
    const view = toStatusView({
      ...base,
      connected: false,
      diagnosis: 'ZOTERO_NOT_RUNNING: offline',
    })
    expect(view.diagnosis).toBe('ZOTERO_NOT_RUNNING: offline')
  })

  it('drops absent optional facts rather than emitting undefined keys', () => {
    const view = toStatusView({ ...base, apiVersion: undefined, serverId: undefined })
    expect('apiVersion' in view).toBe(false)
    expect('serverId' in view).toBe(false)
  })

  it('carries the write state only when the provider wires one', () => {
    expect('write' in toStatusView(base)).toBe(false)
    const withWrite = toStatusView({ ...base, write: { enabled: true, authorized: false } })
    expect(withWrite.write).toEqual({ enabled: true, authorized: false })
  })
})
