/**
 * The job-runner specs' shared fixtures: the owner the fake execution carries,
 * the live registry each case composes, and the execution stub the runner
 * reads. Two specs split along the runner's seams (start/kill, wait/promote)
 * and both need them.
 * @module tests/helpers/job-runner-fixtures
 */

import { afterEach } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { mountRealJobs, type RealJobs } from './real-jobs.js'

/** The owner session `fakeExec` carries. */
export const OWNER = 'session-123'

/** The owner id the runner passes as `caller` for owned jobs. */
export const ownerOf = (hasAgent: boolean): SessionId | undefined =>
  hasAgent ? SessionId(OWNER) : undefined

const open: RealJobs[] = []

afterEach(async () => {
  for (const jobs of open.splice(0)) await jobs.dispose()
})

/** A registry composed for the current case, disposed after it. */
export async function registryOf(): Promise<RealJobs> {
  const jobs = await mountRealJobs()
  open.push(jobs)
  return jobs
}

/** One execution context with (or without) an owning agent. */
export function fakeExec(
  signal: AbortSignal = new AbortController().signal,
  hasAgent = true,
): ToolExecution {
  return {
    callId: 'call-1' as never,
    rootCallId: 'call-1' as never,
    token: 'token-1' as never,
    name: 'test_tool',
    arguments: {},
    signal,
    ...(hasAgent ? { agent: { id: OWNER as SessionId } as never } : {}),
  }
}
