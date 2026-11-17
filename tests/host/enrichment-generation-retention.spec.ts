/** Recently reused generations stay in the bounded admission cache instead of falling back to disk. */
import { afterEach, expect, it, vi } from 'vitest'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  parseJobsFixture,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.ts'

let fixture: ParseJobsFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})
it('refreshes a reused source before admitting the 257th source', async () => {
  fixture = await parseJobsFixture()
  const host = fixture,
    lookups = vi.spyOn(host.persistence, 'generation')
  const admit = async (index: number) => {
    const request = parseRequest(undefined, {
      target: { kind: 'url', url: `https://papers.example.org/document-${index}.pdf` },
    })
    const result = await host.helper.startDocumentParse(request, parseSignal())
    expect(
      (await host.ctx.jobs.wait(JobId(result.jobId), 5000, SessionId(request.sessionId))).status,
    ).toBe('completed')
    return result.generation
  }
  const first = await admit(0)
  for (let index = 1; index < 256; index++) await admit(index)
  const before = lookups.mock.calls.length
  expect(await admit(0)).toBe(first)
  expect(lookups).toHaveBeenCalledTimes(before)
  await admit(256)
  const after = lookups.mock.calls.length
  expect(await admit(0)).toBe(first)
  expect(lookups).toHaveBeenCalledTimes(after)
  await admit(1)
  expect(lookups).toHaveBeenCalledTimes(after + 1)
}, 180_000)
