/** One complete persisted receipt for host and browser contract tests. */
import type { DeliveredResult } from '../../src/result-contract.js'

type FileReceipt = Extract<DeliveredResult, { delivery: 'file' }>
export function resultReceipt(overrides: Partial<FileReceipt> = {}): FileReceipt {
  return {
    delivery: 'file',
    version: 1,
    tool: 'zotero_export',
    sessionId: 'session',
    callId: 'call',
    summary: 'Stored',
    createdAt: 0,
    file: { attachmentId: 'attachment', name: 'result.json', bytes: 12 },
    ...overrides,
  }
}
