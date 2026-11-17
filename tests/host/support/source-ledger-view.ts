/** Test reads use the production projection, through its complete page reader and identity handling. */
import { createSourceLedgerProjection } from '../../../src/session-projection/source-ledger.js'
import type { SourceLedgerState } from '../../../src/sources/event-ledger.js'

export function workspaceOf(ledger: SourceLedgerState, currentServerId?: string) {
  const projection = createSourceLedgerProjection()
  try {
    const state = { ledger }
    return projection.fullWorkspaceOf(state, currentServerId)
  } finally {
    projection.dispose()
  }
}
