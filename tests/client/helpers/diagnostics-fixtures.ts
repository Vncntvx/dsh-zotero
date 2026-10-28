/**
 * The diagnostics card's shared wire fixtures: the plugin subject, the
 * diagnostics envelope, one ring entry, and a connected probe answer.
 * @module tests/client/helpers/diagnostics-fixtures
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ZoteroDiagnosticsView, ZoteroStatusView } from '../../../src/client/remote.ts'

/** The bundle this plugin's diagnostics card owns. */
export const targetSubject: PluginsSubject = {
  kind: 'bundle',
  pkg: {
    name: 'dsh-zotero',
    version: '0.1.0',
    installed: true,
    availability: 'profile',
    official: false,
    enabled: true,
    rows: [],
  },
}

/** A successful diagnostics answer with the card's defaults. */
export function okView(
  overrides: Partial<ZoteroDiagnosticsView> = {},
): RemoteResult<ZoteroDiagnosticsView> {
  return {
    ok: true as const,
    value: {
      entries: [],
      total: 0,
      truncated: false,
      debug: true,
      ...overrides,
    },
  }
}

/** One ring entry; `event` names it and `seq` makes its message unique. */
export function entry(
  seq: number,
  level: 'debug' | 'info' | 'warn' | 'error',
  event: string,
  count = 1,
) {
  return { seq, ts: Date.parse('2026-01-01T00:00:00Z'), level, event, message: `m${seq}`, count }
}

/** A connected probe answer. */
export function fakeProbe(): Promise<RemoteResult<ZoteroStatusView>> {
  return Promise.resolve({
    ok: true as const,
    value: { providerId: 'local', connected: true, endpoint: '127.0.0.1:23119' },
  })
}
