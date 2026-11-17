import { workspaceOf } from './support/source-ledger-view.js'
/** Current Harness cancellation codes agree in both literature-trail folds. */
import { describe, expect, it } from 'vitest'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import { emptyLedgerState, foldLedgerEvent } from '../../src/sources/event-ledger.js'
import { createEventFactory } from './support/source-ledger-events.js'

const ref = 'zotero://user/0/item/ABCD1234'
describe('recorded cancellation', () => {
  it.each([TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH, 'interrupted'])(
    'records %s as stopped without a successful read fact',
    (code) => {
      const event = createEventFactory()
      const state = [
        event('tool/call', {
          callId: 'cancelled',
          name: 'zotero_get',
          arguments: JSON.stringify({ ref }),
        }),
        event('tool/result', {
          message: { toolCallId: 'cancelled', isError: true, content: [] },
          error: { name: 'AbortError', code },
        }),
      ].reduce(foldLedgerEvent, emptyLedgerState())
      const source = workspaceOf(state).sources[0]!
      expect(source.operations).toEqual({ running: 0, failed: 0, stopped: 1 })
      expect(source.facts.reportedEvidenceCount).toBe(0)
      expect(source.evidence).toEqual([])
      expect(source.title).toBeUndefined()
    },
  )
})
