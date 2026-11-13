/**
 * The in-memory per-client acknowledgement the enable-notice specs share: a
 * fresh client starts unacknowledged, `remember` flips the visible flag.
 * @module tests/client/enrichment/support/acknowledgement
 */

import type { EnableNoticeAcknowledgement } from '../../../../src/client/enrichment/enable-notice.ts'

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
  }
  return state
}
