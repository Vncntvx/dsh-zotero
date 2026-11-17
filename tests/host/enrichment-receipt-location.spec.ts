/** Durable operation receipts stay addressable when the artifact output directory changes. */
import { afterEach, expect, it, vi } from 'vitest'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { readdir, realpath, stat } from 'node:fs/promises'
import { DiskParseJobPersistence, EnrichmentParseJobs } from '../../src/enrichment/parse-jobs.ts'
import {
  parseJobsFixture,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.ts'

let fixture: ParseJobsFixture | undefined
const helpers: EnrichmentParseJobs[] = []
afterEach(async () => {
  await Promise.all(helpers.splice(0).map((helper) => helper.dispose()))
  await fixture?.dispose()
  fixture = undefined
  vi.unstubAllEnvs()
})

it('reads the completed receipt after a remount with a different outputDir', async () => {
  fixture = await parseJobsFixture()
  const host = fixture,
    stateHome = await realpath(host.root)
  vi.stubEnv('DSH_HOME', stateHome)
  host.config.value = { ...host.config.value, outputDir: join(stateHome, 'artifacts-a') }
  const persistence = new DiskParseJobPersistence()
  const first = new EnrichmentParseJobs(host.ctx, { ...host.deps, persistence })
  helpers.push(first)
  const request = parseRequest(),
    started = await first.startDocumentParse(request, parseSignal())
  expect(
    (await host.ctx.jobs.wait(JobId(started.jobId), 5000, SessionId(request.sessionId))).status,
  ).toBe('completed')
  const original = await first.documentParseReceipt(
    { sessionId: request.sessionId, operationId: request.operationId },
    parseSignal(),
  )
  expect(original.kind).toBe('completed')
  await first.dispose()
  host.config.value = { ...host.config.value, outputDir: join(stateHome, 'artifacts-b') }
  const second = new EnrichmentParseJobs(host.ctx, {
    ...host.deps,
    persistence: new DiskParseJobPersistence(),
  })
  helpers.push(second)
  expect(
    await second.documentParseReceipt(
      { sessionId: request.sessionId, operationId: request.operationId },
      parseSignal(),
    ),
  ).toEqual(original)
  await expect(second.startDocumentParse(request, parseSignal())).rejects.toMatchObject({
    code: 'ZOTERO_ENRICHMENT_OPERATION_CONFLICT',
  })
  const receiptDir = join(stateHome, 'zotero-receipts', 'parse-jobs')
  expect((await readdir(receiptDir)).filter((name) => name.endsWith('.json'))).toHaveLength(2)
  expect((await stat(receiptDir)).mode & 0o777).toBe(0o700)
  await expect(stat(join(stateHome, 'artifacts-a', 'parse-jobs'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  await expect(stat(join(stateHome, 'artifacts-b', 'parse-jobs'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})
