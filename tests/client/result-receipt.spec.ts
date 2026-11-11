/** The durable-result receipt line is parsed identically by the host and the browser. */
import { describe, expect, it } from 'vitest'
import { RESULT_RECEIPT_PREFIX } from '../../src/constants.js'
import { announcedReceipt, parseReceiptLine } from '../../src/result-receipt.js'
import { receiptOf } from '../../src/client/result-reader.ts'

const RECEIPT = {
  delivery: 'file',
  version: 1,
  tool: 'zotero_get',
  sessionId: 'session',
  callId: 'call',
  summary: 'zotero_get: full result persisted (12 bytes).',
  file: { attachmentId: 'attachment', name: 'zotero_get-result.json', bytes: 12 },
}
const TEXT = `${RESULT_RECEIPT_PREFIX}${JSON.stringify(RECEIPT)}\nFull versioned JSON is in the attached file.`

const BLOCKS = [
  { type: 'text', text: TEXT },
  { type: 'file', attachment: { attachmentId: 'attachment', name: 'r.json', bytes: 12 } },
]

describe('result receipt enrichment', () => {
  it('accepts one complete receipt line the same way on both halves', () => {
    expect(parseReceiptLine(TEXT)).toEqual(RECEIPT)
    expect(announcedReceipt(BLOCKS, 'attachment')).toEqual(RECEIPT)
    expect(receiptOf({ content: BLOCKS, isError: false } as never)).toEqual(RECEIPT)
  })

  it('refuses a receipt for another attachment and a failed block', () => {
    expect(announcedReceipt(BLOCKS, 'other')).toBeUndefined()
    expect(receiptOf({ content: BLOCKS, isError: true } as never)).toBeNull()
  })

  it('refuses a line that is not a complete owned delivery receipt', () => {
    expect(parseReceiptLine('not a receipt')).toBeUndefined()
    expect(parseReceiptLine(`${RESULT_RECEIPT_PREFIX}{`)).toBeUndefined()
    expect(
      parseReceiptLine(
        `${RESULT_RECEIPT_PREFIX}${JSON.stringify({ ...RECEIPT, tool: 'job_output' })}`,
      ),
    ).toBeUndefined()
    expect(
      parseReceiptLine(`${RESULT_RECEIPT_PREFIX}${JSON.stringify({ ...RECEIPT, version: 2 })}`),
    ).toBeUndefined()
  })
})
