/**
 * Admission order when two components owe their disclosure at once.
 *
 * Every case owns one behaviour: the first owed entry is visible, dismissing it
 * admits the next, a component going off withdraws its debt, and disposing an
 * entry hands visibility to the remaining one.
 * @module tests/client/enable-notice-arbiter
 */

import { afterEach, describe, expect, it } from 'vitest'
import { EnableNoticeArbiter, EnableNoticeController } from '../../src/client/enable-notice.ts'
import { acknowledgementOf } from './helpers/acknowledgement.ts'
import { namespaceStatusSourceOf } from './helpers/namespace-status-source.ts'

const controllers: Array<{ dispose(): void }> = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})

function pair() {
  const arbiter = new EnableNoticeArbiter()
  const firstSource = namespaceStatusSourceOf()
  const secondSource = namespaceStatusSourceOf()
  const first = new EnableNoticeController(
    firstSource,
    'enrichmentEnableNotice',
    acknowledgementOf(),
    arbiter,
  )
  const second = new EnableNoticeController(
    secondSource,
    'scholarlyEnableNotice',
    acknowledgementOf(),
    arbiter,
  )
  controllers.push(first, second)
  return {
    first,
    second,
    firstSource,
    secondSource,
    firstOpen: () => first.inject().hooks.enrichmentEnableNotice.getSnapshot().open,
    secondOpen: () => second.inject().hooks.scholarlyEnableNotice.getSnapshot().open,
  }
}

describe('EnableNoticeArbiter', () => {
  it('admits only the first owed disclosure', () => {
    const { firstOpen, secondOpen, firstSource, secondSource } = pair()
    firstSource.publish('ready')
    secondSource.publish('ready')
    expect(firstOpen()).toBe(true)
    expect(secondOpen()).toBe(false)
  })

  it('admits the next owed disclosure after the visible one is dismissed', () => {
    const { first, firstOpen, secondOpen, firstSource, secondSource } = pair()
    firstSource.publish('ready')
    secondSource.publish('ready')
    first.dismiss()
    expect(firstOpen()).toBe(false)
    expect(secondOpen()).toBe(true)
  })

  it('withdraws a disclosure when its component stops being served', () => {
    const { firstOpen, secondOpen, firstSource, secondSource } = pair()
    firstSource.publish('ready')
    secondSource.publish('ready')
    firstSource.publish('unavailable')
    expect(firstOpen()).toBe(false)
    expect(secondOpen()).toBe(true)
  })

  it('hands visibility to the remaining entry when one is disposed', () => {
    const { first, firstOpen, secondOpen, firstSource, secondSource } = pair()
    firstSource.publish('ready')
    secondSource.publish('ready')
    first.dispose()
    expect(firstOpen()).toBe(false)
    expect(secondOpen()).toBe(true)
  })
})
