/**
 * Reading a started background job's id from the two result shapes the specs
 * see: one `ToolExecutionResult` from the host lane and one forwarded tool
 * batch. Both throw a test-only error naming what the call actually answered,
 * so a refusal is never mistaken for a missing id.
 * @module tests/helpers/job-results
 */

import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/**
 * The job id a background tool answered with.
 * @param result - one host-lane tool result.
 * @returns the background job id.
 */
export function backgroundJobIdOf(result: ToolExecutionResult): string {
  if (result.isError) throw new Error('the tool refused the background call')
  const value = result.value as { readonly kind?: string; readonly jobId?: string }
  if (value.kind !== 'background' || value.jobId === undefined) {
    throw new Error('the tool did not start a background job')
  }
  return value.jobId
}

/**
 * The job id one background (or promoted) call answered with, read from a
 * result batch.
 * @param batch - the batch the tool call produced.
 * @returns the job id.
 */
export function batchJobIdOf(batch: {
  readonly results: ReadonlyArray<{ readonly result: unknown }>
}): string {
  const outcome = batch.results[0]?.result as
    { readonly isError?: boolean; readonly value?: { readonly jobId?: string } } | undefined
  const jobId = outcome?.isError === false ? outcome.value?.jobId : undefined
  if (jobId === undefined) throw new Error('the call did not start a job')
  return jobId
}
