/**
 * Unit tests for the shared transport-failure classifier
 * (`src/transport-diagnostics.ts`): the level each failure class grades at,
 * the stable code on the detail, and the silent no-op without a sink. The
 * transports' own specs exercise it end to end over the mock; this pins the
 * classification itself.
 * @module tests/unit/transport-diagnostics
 */

import { describe, expect, it } from 'vitest'
import { ZOTERO_NOT_RUNNING, ZOTERO_TIMEOUT, ZoteroError } from '../../src/errors.js'
import { logTransportFailure } from '../../src/transport-diagnostics.js'
import { recordingSink } from '../helpers/recording-sink.js'

const EVENTS = { abort: 'x.abort', timeout: 'x.timeout', failure: 'x.failure' }

describe('logTransportFailure', () => {
  it('grades a caller abort at debug without appending the error text', () => {
    const { sink, lines } = recordingSink()
    const controller = new AbortController()
    controller.abort()
    logTransportFailure(sink, EVENTS, 'GET users/0/items', 10, new Error('gone'), controller.signal)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'debug',
      event: 'x.abort',
      message: 'GET users/0/items',
    })
    expect(typeof lines[0]?.detail?.ms).toBe('number')
  })

  it('grades the provider deadline at warn with the stable code', () => {
    const { sink, lines } = recordingSink()
    logTransportFailure(
      sink,
      EVENTS,
      'GET users/0/items',
      10,
      new ZoteroError('did not answer', ZOTERO_TIMEOUT),
      undefined,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'warn',
      event: 'x.timeout',
      message: 'GET users/0/items: did not answer',
      detail: { errorCode: ZOTERO_TIMEOUT },
    })
  })

  it('grades a coded refusal at error with the code on the detail', () => {
    const { sink, lines } = recordingSink()
    logTransportFailure(
      sink,
      EVENTS,
      'PATCH users/0/items',
      10,
      new ZoteroError('nope', ZOTERO_NOT_RUNNING),
      undefined,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'error',
      event: 'x.failure',
      message: 'PATCH users/0/items: nope',
      detail: { errorCode: ZOTERO_NOT_RUNNING },
    })
  })

  it('omits the errorCode detail for a failure without a stable code', () => {
    const { sink, lines } = recordingSink()
    logTransportFailure(sink, EVENTS, 'GET users/0/items', 10, new Error('plain boom'), undefined)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'error',
      event: 'x.failure',
      message: 'GET users/0/items: plain boom',
    })
    expect(lines[0]?.detail?.errorCode).toBeUndefined()
  })

  it('renders a non-Error refusal through its string form', () => {
    const { sink, lines } = recordingSink()
    logTransportFailure(sink, EVENTS, 'GET users/0/items', 10, 'bare refusal', undefined)
    expect(lines[0]).toMatchObject({
      level: 'error',
      message: 'GET users/0/items: bare refusal',
    })
  })

  it('is a silent no-op without a sink', () => {
    expect(() =>
      logTransportFailure(
        undefined,
        EVENTS,
        'GET users/0/items',
        10,
        new ZoteroError('nope', ZOTERO_TIMEOUT),
        undefined,
      ),
    ).not.toThrow()
  })
})
