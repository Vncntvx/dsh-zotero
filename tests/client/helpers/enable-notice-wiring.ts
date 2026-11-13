/**
 * The shared enable-disclosure wiring contract.
 *
 * Both component cards publish a `namespaceStatus`, and both notices read it
 * through the real card store rather than a hand-built source. One parameterised
 * suite keeps the two specs from drifting: adding an assertion here tests both
 * components' wiring at once.
 * @module tests/client/helpers/enable-notice-wiring
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  EnableNoticeArbiter,
  EnableNoticeController,
  type EnableNoticeHookName,
} from '../../../src/client/enable-notice.ts'
import type { NamespaceStatus } from '../../../src/client/helpers/namespace-status.ts'
import { acknowledgementOf } from './acknowledgement.ts'

/** What one component's spec contributes to the shared suite. */
export interface EnableNoticeWiringCase<Card, Hook extends EnableNoticeHookName> {
  /** Label for the describe block. */
  readonly label: string
  /** The hook name this component's notice publishes. */
  readonly hook: Hook
  /** Build the real card controller over a scope with the given initial status. */
  readonly cardOf: (status: NamespaceStatus) => Card
  /** Read the component's card snapshot store from its controller. */
  readonly storeOf: (card: Card) => {
    getSnapshot(): { readonly namespaceStatus: NamespaceStatus }
    subscribe(listener: () => void): () => void
  }
  /** Publish a Host-side status/revision update. */
  readonly publish: (card: Card, patch: { status?: NamespaceStatus; revision?: number }) => void
  /** Dispose the card controller. */
  readonly dispose: (card: Card) => void
}

/**
 * Run the same wiring assertions for one component.
 * @param testCase - the component's card factory and hook name.
 */
export function describeEnableNoticeWiring<Card, Hook extends EnableNoticeHookName>(
  testCase: EnableNoticeWiringCase<Card, Hook>,
): void {
  const cards: Card[] = []
  const notices: Array<{ dispose(): void }> = []

  afterEach(() => {
    for (const notice of notices.splice(0)) notice.dispose()
    for (const card of cards.splice(0)) testCase.dispose(card)
  })

  const mount = (status: NamespaceStatus) => {
    const card = testCase.cardOf(status)
    cards.push(card)
    const store = testCase.storeOf(card)
    const acknowledgement = acknowledgementOf()
    const notice = new EnableNoticeController(
      store,
      testCase.hook,
      acknowledgement,
      new EnableNoticeArbiter(),
    )
    notices.push(notice)
    const open = () => notice.inject().hooks[testCase.hook].getSnapshot().open
    return { card, store, notice, acknowledgement, open }
  }

  describe(testCase.label, () => {
    it('opens when the component becomes served through the real card store', () => {
      const { card, store, notice, acknowledgement, open } = mount('unavailable')

      // The component is not served: nothing is owed.
      expect(store.getSnapshot().namespaceStatus).toBe('unavailable')
      expect(open()).toBe(false)

      // The deployment flips the component on: the form's namespace becomes
      // ready, the controller republishes, and the disclosure opens.
      testCase.publish(card, { status: 'ready' })
      expect(store.getSnapshot().namespaceStatus).toBe('ready')
      expect(open()).toBe(true)

      // The user accepts; the acknowledgement is written and the notice closes,
      // and a later status refresh does not reopen it.
      notice.dismiss()
      expect(acknowledgement.read()).toBe(true)
      expect(open()).toBe(false)
      testCase.publish(card, { revision: 2 })
      expect(open()).toBe(false)
    })

    it('opens for a deployment already enabled when the client mounts', () => {
      const { store, open } = mount('ready')
      expect(store.getSnapshot().namespaceStatus).toBe('ready')
      expect(open()).toBe(true)
    })

    it('asks again after the component is turned off and back on', () => {
      const { card, notice, open } = mount('unavailable')
      testCase.publish(card, { status: 'ready' })
      notice.dismiss()
      testCase.publish(card, { status: 'unavailable' })
      expect(open()).toBe(false)
      testCase.publish(card, { status: 'ready' })
      expect(open()).toBe(true)
    })
  })
}
