/** Durable admission and passage deduplication preserve only supported, attributable facts. */
import { expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { RESULT_RECEIPT_PREFIX } from '../../src/constants.js'
import { emptyLedgerState, factsOf, foldLedgerEvent } from '../../src/sources/event-ledger.js'
import { buildSourceWorkspace } from '../../src/sources/ledger.js'
import { sourceWorkspaceSchema } from '../../src/sources/workspace-schema.js'
import { resultReceipt } from '../helpers/result-receipts.ts'
import { createEventFactory } from './support/source-ledger-events.ts'
import { settledBlock } from './support/source-ledger-arms.ts'

it.each([
  { tool: 'zotero_browse', retained: false },
  { tool: 'zotero_changes', retained: false },
  { tool: 'zotero_create_item', retained: false },
  { tool: 'zotero_export', retained: true },
])('retains the $tool durable job receipt only when the trail folds it', ({ tool, retained }) => {
  const event = createEventFactory(),
    initial = emptyLedgerState()
  const called = foldLedgerEvent(
    initial,
    event('tool/call', { callId: 'job-output', name: 'job_output', arguments: '{}' }),
  )
  const settled = foldLedgerEvent(
    called,
    event('tool/result', {
      message: {
        toolCallId: 'job-output',
        content: [
          { type: 'text', text: RESULT_RECEIPT_PREFIX + JSON.stringify(resultReceipt({ tool })) },
          {
            type: 'file',
            attachment: {
              attachmentId: AttachmentId('attachment'),
              name: 'result.json',
              bytes: 12,
            },
          },
        ],
      },
    }),
  )
  expect(factsOf(settled)).toHaveLength(retained ? 1 : 0)
  expect(settled.pending).toEqual({})
})

it('keeps the same annotation text separately for different attachments and match provenance', () => {
  const ref = 'zotero://user/0/item/ABCD1234'
  const base = {
    source: 'annotation',
    sourceRef: 'zotero://user/0/annotation/ANNO1234',
    preview: 'The same evidence text.',
    previewTruncated: false,
    attachmentRef: 'zotero://user/0/attachment/ATTACH01',
    matchKind: 'lexical',
    matchedFields: ['text'],
  }
  const items = [
    base,
    { ...base, attachmentRef: 'zotero://user/0/attachment/ATTACH02' },
    { ...base, matchKind: 'semantic' },
    { ...base, matchedFields: ['comment'] },
  ]
  const first = settledBlock(
    'first',
    'zotero_retrieve',
    { ref, query: 'evidence' },
    { count: 4, items, truncated: false, sourceAvailability: {} },
    1,
  )
  const second = settledBlock(
    'again',
    'zotero_retrieve',
    { ref, query: 'evidence' },
    { count: 1, items: [base], truncated: false, sourceAvailability: {} },
    2,
  )
  const workspace = buildSourceWorkspace([first, second])
  const evidence = workspace.sources[0]!.evidence
  expect(evidence).toHaveLength(4)
  expect(evidence[0]).toMatchObject({
    attachmentRef: base.attachmentRef,
    matchKind: 'lexical',
    matchedFields: ['text'],
    callIds: ['first', 'again'],
  })
  expect(evidence[1]).toMatchObject({ attachmentRef: 'zotero://user/0/attachment/ATTACH02' })
  expect(evidence[2]).toMatchObject({ matchKind: 'semantic' })
  expect(evidence[3]).toMatchObject({ matchedFields: ['comment'] })
  expect(sourceWorkspaceSchema.safeParse(workspace).success).toBe(true)
})
