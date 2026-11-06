/**
 * The one `ZoteroStatusView` builder the status-facing specs share: a
 * connected, not-composed default that each spec overrides only in the facts
 * it varies. Every field the wire requires is present, so adding a required
 * fact edits one place instead of every spec. Deliberately malformed wire
 * samples stay literal in the specs that test them; this builder is for
 * valid views only.
 * @module tests/helpers/status-view
 */

import type { ZoteroStatusView } from '../../src/client/remote.ts'

/**
 * Assemble a valid status view from the shared default plus per-spec facts.
 * @param overrides - the facts this spec varies; every other field keeps the
 *   default (connected local provider, projection not composed).
 * @returns the complete view.
 */
export function statusView(
  overrides: Partial<Omit<ZoteroStatusView, 'sourceProjection'>> & {
    sourceProjection?: ZoteroStatusView['sourceProjection']
  } = {},
): ZoteroStatusView {
  return {
    providerId: 'local',
    sourceProjection: { state: 'not-composed' },
    connected: true,
    ...overrides,
  }
}
