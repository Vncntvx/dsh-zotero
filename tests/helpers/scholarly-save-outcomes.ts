/** Canonical write outcomes used to capture and replay actual tool receipts. */
import type { ZoteroCreateItemOutcome } from '../../src/types.js'

export const SCHOLARLY_SAVE_STATES = [
  'declined',
  'commit-unknown',
  'saved-state-unverified',
  'applied',
] as const
export function scholarlySaveOutcome(
  state: (typeof SCHOLARLY_SAVE_STATES)[number],
): ZoteroCreateItemOutcome {
  if (state === 'declined') return { kind: 'declined' }
  const identity = {
    ref: 'zotero://user/0/item/NOTE0001?server=srv-save',
    key: 'NOTE0001',
    version: 12,
    serverId: 'srv-save',
  }
  return state === 'applied'
    ? { kind: 'applied', ...identity, libraryVersion: 12, itemType: 'journalArticle' }
    : {
        kind: 'committed-unverified',
        reason: state,
        committed: true,
        retryable: false,
        ...identity,
      }
}
