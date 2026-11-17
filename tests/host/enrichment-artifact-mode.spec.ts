/** Inspection and ordinary reads use the committed artifact's byte cap after a mode change. */
import { expect, it, vi } from 'vitest'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { ENRICHMENT_DOCUMENT_LIMITS } from '../../src/enrichment-preferences.ts'
import { DOCUMENT_URL, OWNER, endpointFixture } from './support/enrichment-parse-endpoints.ts'

it('preserves a free artifact cap in both readers after switching live configuration to pro', async () => {
  const fixture = await endpointFixture()
  try {
    fixture.grant()
    const started = await fixture.start()
    expect((await fixture.ctx.jobs.wait(JobId(started.jobId), 5000, OWNER)).status).toBe(
      'completed',
    )
    const head = vi.spyOn(fixture.http.client, 'head')
    fixture.ctx.enrichment.config = {
      ...fixture.config,
      mode: 'pro',
      mineruTokenRef: 'unresolved-credential',
    }
    const before = fixture.http.calls.length
    expect(await fixture.artifact({ kind: 'url', url: DOCUMENT_URL })).toMatchObject({
      kind: 'ready',
      mode: 'free',
    })
    expect(head.mock.lastCall?.[1]).toMatchObject({
      maxBytes: ENRICHMENT_DOCUMENT_LIMITS.free.maxBytes,
    })
    expect(
      await fixture.ctx.enrichment.enhancer.lookup({
        key: DOCUMENT_URL,
        source: { kind: 'url', url: DOCUMENT_URL },
      }),
    ).toMatchObject({ kind: 'hit', provenance: { mode: 'free' } })
    expect(head.mock.lastCall?.[1]).toMatchObject({
      maxBytes: ENRICHMENT_DOCUMENT_LIMITS.free.maxBytes,
    })
    expect(fixture.http.calls.slice(before).every(({ init }) => init.method === 'HEAD')).toBe(true)
  } finally {
    await fixture.dispose()
    vi.restoreAllMocks()
  }
})
