/**
 * The harness approval boundary: only the structured `ApprovalError` identity
 * with a user-decision code may become a panel `declined` result. Every input
 * here is built from the module's own constants, so an upstream code change is
 * caught by the table below.
 */
import { describe, expect, it } from 'vitest'
import {
  HARNESS_DENIAL_CODES,
  HARNESS_DENIAL_NAME,
  classifyDenial,
} from '../../../src/library-write-denial.js'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { toolExecutionResult } from '../support/tool-batch.js'

/** One failed execution result carrying the harness approval identity. */
function denial(code: string): ToolExecutionResult {
  return toolExecutionResult({
    isError: true,
    content: [],
    error: {
      message: 'the plan review did not grant this write',
      info: { name: HARNESS_DENIAL_NAME, code },
    },
  })
}

/** One failed execution result with a structured identity under another name. */
function foreignFailure(name: string, code: string): ToolExecutionResult {
  return toolExecutionResult({
    isError: true,
    content: [],
    error: { message: 'write conflict', info: { name, code } },
  })
}

describe('classifyDenial', () => {
  it.each(HARNESS_DENIAL_CODES)('classifies the %s approval code as a user decline', (code) => {
    expect(classifyDenial(denial(code))).toBe('declined')
  })

  it('treats an unavailable approval channel as a failure, not a decline', () => {
    expect(classifyDenial(denial('APPROVAL_UNAVAILABLE'))).toBe('failed')
  })

  it('ignores an approval code carried under another error name', () => {
    expect(classifyDenial(foreignFailure('ZoteroError', 'APPROVAL_REJECTED'))).toBe('failed')
  })

  it('does not read the model-facing refusal sentence', () => {
    const result = toolExecutionResult({
      isError: true,
      content: [],
      error: { message: 'the user rejected tool "zotero_create_note"' },
    })
    expect(classifyDenial(result)).toBe('failed')
  })

  it('does not classify an unrelated structured code', () => {
    expect(classifyDenial(foreignFailure('ZoteroError', 'ZOTERO_WRITE_CONFLICT'))).toBe('failed')
  })

  it('does not classify a successful execution result', () => {
    expect(classifyDenial(toolExecutionResult({ isError: false, content: [] }))).toBe('failed')
  })
})
