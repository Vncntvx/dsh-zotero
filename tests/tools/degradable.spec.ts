/**
 * The preview degrade rule: which failed blast-radius reads a plan card may
 * render as `unknown`, and which must reach the caller.
 *
 * The rule is a pure decision function, so this spec drives it directly rather
 * than standing up a tool lane: the properties that matter are the three-way
 * outcome (degrade / rethrow-as-is / rethrow-as-cancellation) and their
 * precedence. `tests/tools/delete-collection.spec.ts` and
 * `delete-library-tags.spec.ts` cover the same rule end-to-end through the two
 * write tools.
 * @module tests/tools/degradable
 */

import { describe, expect, it } from 'vitest'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZOTERO_TIMEOUT,
  ZoteroError,
} from '../../src/errors.ts'
import { previewOutcomeOf } from '../../src/tools/degradable.ts'

/** One aborted caller signal. */
function abortedSignal(): AbortSignal {
  const controller = new AbortController()
  controller.abort()
  return controller.signal
}

describe('previewOutcomeOf', () => {
  it('degrades a target that does not exist', () => {
    const outcome = previewOutcomeOf(
      new ZoteroError('no such collection', ZOTERO_NOT_FOUND),
      undefined,
      {},
    )
    expect(outcome).toEqual({ kind: 'degrade', value: {} })
  })

  it('degrades a name that matches several objects', () => {
    const outcome = previewOutcomeOf(
      new ZoteroError('two collections share the name', ZOTERO_SCOPE_AMBIGUOUS),
      undefined,
      {},
    )
    expect(outcome).toEqual({ kind: 'degrade', value: {} })
  })

  it('rethrows a real fault with its original error', () => {
    // A deadline is a fault, not an inconclusive preview: the caller must see
    // ZOTERO_TIMEOUT, not a plan whose radius reads "unknown".
    const failure = new ZoteroError('preview deadline exceeded', ZOTERO_TIMEOUT)
    const outcome = previewOutcomeOf(failure, undefined, {})
    expect(outcome).toEqual({ kind: 'rethrow', error: failure })
  })

  it('rethrows a non-Zotero failure untouched', () => {
    const failure = new TypeError('protocol shape changed')
    const outcome = previewOutcomeOf(failure, undefined, {})
    expect(outcome).toEqual({ kind: 'rethrow', error: failure })
  })

  it('reports an aborted call as the harness cancellation, whatever the failure was', () => {
    // Cancellation outranks the degrade rule: the caller who cancelled must
    // see the harness's own TOOL_ABORTED, and the underlying failure rides as
    // the cause so the error chain still shows what the read ran into.
    const failure = new ZoteroError('no such collection', ZOTERO_NOT_FOUND)
    const outcome = previewOutcomeOf(failure, abortedSignal(), {})
    expect(outcome.kind).toBe('rethrow')
    if (outcome.kind !== 'rethrow') return
    expect(outcome.error).toBeInstanceOf(HarnessError)
    expect((outcome.error as HarnessError).code).toBe(TOOL_ABORTED)
    expect((outcome.error as HarnessError).message).toBe('tool call aborted')
    expect((outcome.error as { cause?: unknown }).cause).toBe(failure)
  })

  it('reports an aborted call as the cancellation even when the failure was a fault', () => {
    // The other side of the same precedence: an already-aborted caller whose
    // read then fails with a 500 must still be a cancellation, not a domain
    // error the harness would render as a tool failure.
    const failure = new ZoteroError('preview deadline exceeded', ZOTERO_TIMEOUT)
    const outcome = previewOutcomeOf(failure, abortedSignal(), {})
    expect(outcome.kind).toBe('rethrow')
    if (outcome.kind !== 'rethrow') return
    expect(outcome.error).toBeInstanceOf(HarnessError)
    expect((outcome.error as HarnessError).code).toBe(TOOL_ABORTED)
    expect((outcome.error as { cause?: unknown }).cause).toBe(failure)
  })
})
