/**
 * Transport rebuild keys and the `loader/volatile-update` path filter: only
 * HTTP-client identity/bounds, the write client's dialog budget, and the
 * write-capability flip rebuild; every other bound (the scope-listing TTL
 * included) is read live through the provider's limits getter.
 * @module tests/unit/transport-keys
 */

import { describe, expect, it } from 'vitest'
import {
  HEAVY_TOOL_CONFIG_KEYS,
  touchesHeavyTools,
  touchesTransport,
  TRANSPORT_CONFIG_KEYS,
} from '../../src/service.js'

describe('TRANSPORT_CONFIG_KEYS', () => {
  it('names only the fields baked into the transport stack', () => {
    expect([...TRANSPORT_CONFIG_KEYS].sort()).toEqual([
      'baseUrl',
      'maxInFlightRequests',
      'maxResponseBytes',
      'timeoutMs',
      'writeAuthorizeDeadlineMs',
      'writeEnabled',
    ])
  })
})

describe('HEAVY_TOOL_CONFIG_KEYS', () => {
  it('names only the fields that flip background tool capabilities', () => {
    expect([...HEAVY_TOOL_CONFIG_KEYS]).toEqual(['enableRunInBackground'])
  })
})

describe('touchesHeavyTools', () => {
  it('reacts to enableRunInBackground and the whole-config root path', () => {
    expect(touchesHeavyTools([['enableRunInBackground']])).toBe(true)
    expect(touchesHeavyTools([[]])).toBe(true)
  })

  it('ignores transport fields and limits', () => {
    expect(touchesHeavyTools([['baseUrl']])).toBe(false)
    expect(touchesHeavyTools([['maxSearchResults']])).toBe(false)
    expect(touchesHeavyTools([['writeEnabled']])).toBe(false)
  })
})

describe('touchesTransport', () => {
  it('reacts to transport fields and the whole-config root path', () => {
    expect(touchesTransport([['baseUrl']])).toBe(true)
    expect(touchesTransport([['writeEnabled']])).toBe(true)
    expect(touchesTransport([['maxInFlightRequests']])).toBe(true)
    expect(touchesTransport([['writeAuthorizeDeadlineMs']])).toBe(true)
    expect(touchesTransport([[]])).toBe(true)
  })

  it('ignores live-read fields and limits', () => {
    expect(touchesTransport([['provider']])).toBe(false)
    expect(touchesTransport([['writePersistKey']])).toBe(false)
    expect(touchesTransport([['maxSearchResults'], ['timeoutMs']])).toBe(true)
    expect(touchesTransport([['maxSearchResults'], ['defaultStyle']])).toBe(false)
    expect(touchesTransport([['searchConcurrency']])).toBe(false)
    expect(touchesTransport([['graphConcurrency']])).toBe(false)
    expect(touchesTransport([['retrieveAttachmentCap']])).toBe(false)
    // The scope-listing TTL is compared at each lookup through the live
    // limits, so editing it must not tear the transport stack down.
    expect(touchesTransport([['scopeListingTtlMs']])).toBe(false)
  })
})
