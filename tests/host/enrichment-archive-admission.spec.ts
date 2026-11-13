/**
 * The configured archive limits reach the archive admission of a live
 * service: a busy slot and a full queue refuse the next parse instead of
 * waiting under the default limits.
 * @module tests/host/enrichment-archive-admission
 */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { describe, expect, it } from 'vitest'
import { ARTIFACT_READER_DEFAULTS } from '../../src/artifact-reader-preferences.ts'
import type { ZoteroStartDocumentParseRequestView } from '../../src/contract.ts'
import {
  DOCUMENT_URL,
  OWNER,
  RESULT,
  endpointFixture,
} from './support/enrichment-parse-endpoints.ts'

const SECOND_URL = 'https://papers.example.org/second.pdf?edition=2'
const THIRD_URL = 'https://papers.example.org/third.pdf?edition=2'
const FIRST_OPERATION = '11111111-1111-4111-8111-111111111111'
const SECOND_OPERATION = '22222222-2222-4222-8222-222222222222'
const THIRD_OPERATION = '33333333-3333-4333-8333-333333333333'

function parseRequest(operationId: string, url: string): ZoteroStartDocumentParseRequestView {
  return { sessionId: OWNER, operationId, target: { kind: 'url', url }, action: 'parse' }
}

describe('the configured archive admission', () => {
  it('refuses the parse that exceeds the configured archive queue', async () => {
    const fixture = await endpointFixture({
      config: {
        artifactReader: {
          ...ARTIFACT_READER_DEFAULTS,
          archiveConcurrency: 1,
          archiveQueueLimit: 1,
        },
      },
      holdResult: true,
    })
    try {
      fixture.grant()
      const first = await fixture.start(parseRequest(FIRST_OPERATION, DOCUMENT_URL))
      // The first parse holds the archive slot: its result download waits.
      await fixture.http.activity.when(() => fixture.http.calls.some(({ url }) => url === RESULT))
      const second = await fixture.start(parseRequest(SECOND_OPERATION, SECOND_URL))
      const third = await fixture.start(parseRequest(THIRD_OPERATION, THIRD_URL))
      const abort = new AbortController()
      const settle = (jobId: string) =>
        fixture.ctx.jobs.wait(JobId(jobId), 3000, OWNER, abort.signal).catch(() => undefined)
      let queuedId: string
      try {
        const refused = await Promise.race([settle(second.jobId), settle(third.jobId)])
        expect(refused?.status).toBe('failed')
        expect(refused?.detail).toMatch(/Archive processing is busy/)
        queuedId = refused!.id === second.jobId ? third.jobId : second.jobId
      } finally {
        abort.abort()
      }
      // The waiting parse takes the freed slot and completes.
      fixture.http.releaseResult()
      const queued = await fixture.ctx.jobs.wait(JobId(queuedId), 10000, OWNER)
      expect(queued.status).toBe('completed')
      const held = await fixture.ctx.jobs.wait(JobId(first.jobId), 10000, OWNER)
      expect(held.status).toBe('completed')
    } finally {
      await fixture.dispose()
    }
  }, 15000)
})
