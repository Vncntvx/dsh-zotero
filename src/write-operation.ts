/** One foreground write owns its full read-modify-write cycle and deadline. */
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { acquireSlot, ConcurrencyGate } from './concurrency.js'
import { ZoteroError, ZoteroWriteCommitUnknownError, ZOTERO_TIMEOUT } from './errors.js'

/** Starts after plan approval; includes queueing, authorization and graph verification. */
export const WRITE_OPERATION_DEADLINE_MS = 15 * 60_000

export async function runWriteOperation<T>(
  gate: ConcurrencyGate,
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  using budget = deadline(signal, WRITE_OPERATION_DEADLINE_MS, ZOTERO_TIMEOUT)
  try {
    const release = await acquireSlot(gate, budget.signal)
    try {
      return await operation(budget.signal)
    } finally {
      release()
    }
  } catch (error) {
    // A dispatched write may already have committed. Its reconciliation
    // outcome must survive both this deadline and caller cancellation.
    if (error instanceof ZoteroWriteCommitUnknownError) throw error
    if (timeoutOf(budget.signal, ZOTERO_TIMEOUT) !== undefined)
      throw new ZoteroError(
        'The Zotero write exceeded its 15-minute operation deadline. Check any completed or unverified refs before further action.',
        ZOTERO_TIMEOUT,
        { cause: error },
      )
    throw error
  }
}
