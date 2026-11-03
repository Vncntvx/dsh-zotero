/**
 * The premise of the whole capability, asserted against the harness's own
 * contract instead of against this plugin: a stored log carrying `zotero/status`
 * without `ignorable` is refused by `validateStoredEvents`, and adding the one
 * marker is enough to make the same log readable.
 *
 * This is the only spec whose judgement does not come from production code in
 * this repository. It exists so that the repair target: and the retired type
 * list the repair names: cannot drift away from the harness unnoticed.
 * @module tests/host/remediation-seam
 */

import { describe, expect, it } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import {
  SessionFormatUnsupportedError,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { RETIRED_SESSION_EVENT_TYPES } from '../../src/remediation/session-events.js'

const HEADER = {
  id: 'session-1aa4e258',
  version: 4,
  createdAt: 1_700_000_000_000,
  isSeeded: false,
  delegationDepth: 0,
} as unknown as SessionHeader

/** One retired plugin event, unmarked unless `ignorable` is set. */
function statusEvent(seq: number, ignorable?: boolean): SessionEvent {
  return {
    type: 'zotero/status',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { version: 1, status: { connected: true, providerId: 'local' } },
    ...(ignorable === undefined ? {} : { ignorable }),
  } as unknown as SessionEvent
}

describe('the retired zotero/status event', () => {
  it('is outside the harness vocabulary so a read refuses an unmarked log', () => {
    expect(KNOWN_SESSION_EVENT_TYPES.has('zotero/status')).toBe(false)

    expect(() => validateStoredEvents(HEADER, [statusEvent(0)])).toThrow(
      SessionFormatUnsupportedError,
    )
  })

  it('is accepted once every record carries ignorable: true', () => {
    const events = [statusEvent(0, true), statusEvent(1, true)]
    expect(validateStoredEvents(HEADER, events)).toBe(events)
  })

  it('is the only type the plugin declares retired', () => {
    expect(RETIRED_SESSION_EVENT_TYPES).toEqual(['zotero/status'])
  })
})
