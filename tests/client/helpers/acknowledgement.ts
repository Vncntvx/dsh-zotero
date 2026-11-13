/**
 * The in-memory acknowledgement the enable-notice specs share: a fresh client
 * starts unacknowledged, `remember` flips the visible flag, `forget` clears it
 * when the component is observed off. Each disclosure gets its own instance,
 * mirroring the per-key storage a browser keeps.
 * @module tests/client/helpers/acknowledgement
 */

import type { EnableNoticeAcknowledgement } from '../../../src/client/enable-notice.ts'

/** One spec-client acknowledgement with its state exposed for assertions. */
export type SpecAcknowledgement = EnableNoticeAcknowledgement & { acknowledged: boolean }

/**
 * A fresh client acknowledgement.
 * @returns the acknowledgement with its current state.
 */
export function acknowledgementOf(): SpecAcknowledgement {
  const state: SpecAcknowledgement = {
    acknowledged: false,
    read: () => state.acknowledged,
    remember: () => {
      state.acknowledged = true
    },
    forget: () => {
      state.acknowledged = false
    },
  }
  return state
}
