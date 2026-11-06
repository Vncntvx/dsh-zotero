/**
 * The harness refusal boundary: only an exact, tool-scoped denial sentence or
 * a structured denial code may become a panel `declined` result. Every input
 * here is built from the module's own boundary constants, so an upstream
 * wording change is caught by the matcher derivation cases below.
 */
import { describe, expect, it } from 'vitest'
import {
  HARNESS_APPROVAL_CANCELLED,
  HARNESS_DENIAL_CODES,
  HARNESS_REFUSAL_TEMPLATES,
  HARNESS_USER_REJECTION,
  classifyDenial,
} from '../../../src/library-write-denial.js'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { harnessRefusal, toolExecutionResult } from '../support/tool-batch.js'

const TOOL = 'zotero_create_note'

/** One failed execution result with an optional structured error code. */
function failure(message: string, code?: string): ToolExecutionResult {
  return toolExecutionResult({
    isError: true,
    content: [],
    error: {
      message,
      ...(code === undefined ? {} : { info: { name: 'ApprovalError', code } }),
    },
  })
}

describe('classifyDenial', () => {
  it('classifies the exact user-rejection sentence for the dispatched tool', () => {
    expect(classifyDenial(failure(harnessRefusal('rejected', TOOL)), TOOL)).toBe('declined')
  })

  it('classifies the exact cancelled-approval sentence for the dispatched tool', () => {
    expect(classifyDenial(failure(harnessRefusal('cancelled', TOOL)), TOOL)).toBe('declined')
  })

  it('does not classify a refusal sentence naming a different tool', () => {
    const other = 'zotero_batch_items'
    expect(classifyDenial(failure(harnessRefusal('rejected', other)), TOOL)).toBe('failed')
    expect(classifyDenial(failure(harnessRefusal('cancelled', other)), TOOL)).toBe('failed')
  })

  it('recognizes a structured denial code before reading the wording', () => {
    const [code] = HARNESS_DENIAL_CODES
    expect(code).toBeDefined()
    expect(classifyDenial(failure('an infrastructure failure', code), TOOL)).toBe('declined')
  })

  it('does not classify an unrelated structured code', () => {
    expect(classifyDenial(failure('write conflict', 'ZOTERO_WRITE_CONFLICT'), TOOL)).toBe('failed')
  })

  it('does not classify an error that merely mentions a rejected tool', () => {
    const message = `gateway failed after ${harnessRefusal('rejected', TOOL)}`
    expect(classifyDenial(failure(message), TOOL)).toBe('failed')
  })

  it('does not classify a refusal sentence with trailing text', () => {
    const message = `${harnessRefusal('rejected', TOOL)} (retry later)`
    expect(classifyDenial(failure(message), TOOL)).toBe('failed')
  })

  it('does not classify a quoted sentence that is not a refusal', () => {
    expect(classifyDenial(failure(`the gateway quoted "${TOOL}" while failing`), TOOL)).toBe(
      'failed',
    )
  })

  it('does not classify a successful execution result', () => {
    const success = toolExecutionResult({ isError: false, content: [] })
    expect(classifyDenial(success, TOOL)).toBe('failed')
  })
})

describe('harness refusal boundary constants', () => {
  it.each(['rejected', 'cancelled'] as const)(
    'derives the %s matcher from its documented sentence',
    (kind) => {
      const pattern = kind === 'rejected' ? HARNESS_USER_REJECTION : HARNESS_APPROVAL_CANCELLED
      expect(HARNESS_REFUSAL_TEMPLATES[kind]).toContain('$TOOL')
      expect(pattern.exec(harnessRefusal(kind, TOOL))?.[1]).toBe(TOOL)
      expect(pattern.exec(harnessRefusal(kind, `${TOOL} extra`))?.[1]).toBe(`${TOOL} extra`)
    },
  )
})
