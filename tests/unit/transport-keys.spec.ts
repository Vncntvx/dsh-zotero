/**
 * Transport rebuild keys and the `loader/volatile-update` path filter: only
 * HTTP-client identity/bounds and the write-capability flip rebuild; provider
 * selection and `writePersistKey` are live reads.
 * @module tests/unit/transport-keys
 */

import { describe, expect, it } from 'vitest'
import { touchesTransport, TRANSPORT_CONFIG_KEYS } from '../../src/service.js'

describe('TRANSPORT_CONFIG_KEYS', () => {
  it('names only the fields baked into the transport stack', () => {
    expect([...TRANSPORT_CONFIG_KEYS].sort()).toEqual([
      'baseUrl',
      'maxResponseBytes',
      'timeoutMs',
      'writeEnabled',
    ])
  })
})

describe('touchesTransport', () => {
  it('reacts to transport fields and the whole-config root path', () => {
    expect(touchesTransport([['baseUrl']])).toBe(true)
    expect(touchesTransport([['writeEnabled']])).toBe(true)
    expect(touchesTransport([[]])).toBe(true)
  })

  it('ignores live-read fields and limits', () => {
    expect(touchesTransport([['provider']])).toBe(false)
    expect(touchesTransport([['writePersistKey']])).toBe(false)
    expect(touchesTransport([['maxSearchResults'], ['timeoutMs']])).toBe(true)
    expect(touchesTransport([['maxSearchResults'], ['writeConfirm']])).toBe(false)
  })
})
