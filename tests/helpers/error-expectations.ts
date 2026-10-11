/**
 * Shared assertion helper for the transport specs: settles a promise and
 * asserts it rejected with a `HarnessError` carrying the expected stable
 * code (and optionally a message fragment), handing the error back for
 * further assertions.
 * @module tests/helpers/error-expectations
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { expect } from 'vitest'

/**
 * @param promise - the call expected to reject.
 * @param code - the stable error code the rejection must carry.
 * @param messagePart - an optional fragment the message must contain.
 * @returns the thrown `HarnessError`, for assertions beyond the code.
 */
export async function expectZoteroError(
  promise: Promise<unknown>,
  code: string,
  messagePart?: string,
): Promise<HarnessError> {
  let thrown: unknown
  try {
    await promise
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(HarnessError)
  const harnessError = thrown as HarnessError
  expect(harnessError.code).toBe(code)
  if (messagePart !== undefined) expect(harnessError.message).toContain(messagePart)
  return harnessError
}
