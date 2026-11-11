/** Admission, real registry ownership, idempotence, and durable receipt isolation. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE,
  ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
  ZOTERO_ENRICHMENT_UPLOAD_DISABLED,
  ZOTERO_NOT_FOUND,
} from '../../src/errors.js'
import { PARSE_JOB_KIND, PARSE_JOB_LABEL } from '../../src/enrichment/parse-jobs.js'
import { deferred } from '../helpers/sync.js'
import {
  parseJobsFixture,
  parsedResult,
  parseRequest,
  parseSignal,
  type ParseJobsFixture,
} from './support/enrichment-parse-jobs.js'

let fixture: ParseJobsFixture | undefined
afterEach(async () => {
  await fixture?.dispose()
  fixture = undefined
  vi.restoreAllMocks()
})

async function settled(host: ParseJobsFixture, jobId: string, owner = 'parse-owner') {
  return await host.ctx.jobs.wait(JobId(jobId), 5000, SessionId(owner))
}

describe('explicit parsing admission and receipts', () => {
  it('admits an idle live Agent with a real owned job and no fabricated tool call', async () => {
    const task = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        await task.promise
        return parsedResult(execution)
      },
    })
    const request = parseRequest()
    const result = await fixture.helper.startDocumentParse(request, parseSignal())
    expect(fixture.ctx.jobs.get(JobId(result.jobId), SessionId(request.sessionId))).toMatchObject({
      owner: request.sessionId,
      kind: PARSE_JOB_KIND,
      label: PARSE_JOB_LABEL,
      status: 'running',
    })
    const registration = fixture.owners[0]!.agent.session.snapshotEvents().find(
      (event) => event.type === 'job/registered',
    )
    expect(registration?.data).toMatchObject({ jobId: result.jobId, owner: request.sessionId })
    expect(registration?.data).not.toHaveProperty('toolCall')
    task.resolve()
    expect((await settled(fixture, result.jobId)).status).toBe('completed')
  })

  it('rejects a disabled upload gate before attachment resolution, storage, or source execution', async () => {
    fixture = await parseJobsFixture()
    fixture.config.value = { ...fixture.config.value, allowDocumentUpload: false }
    const storage = vi.spyOn(fixture.persistence, 'get')
    await expect(
      fixture.helper.startDocumentParse(
        parseRequest(undefined, { target: fixture.attachment }),
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_UPLOAD_DISABLED })
    expect(fixture.resolveAttachment).not.toHaveBeenCalled()
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(SessionId('parse-owner'))).toEqual([])
  })

  it('lets the real registry reject a session with no attached job controller before source I/O', async () => {
    fixture = await parseJobsFixture({}, { controller: false })
    await expect(
      fixture.helper.startDocumentParse(parseRequest(), parseSignal()),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_JOBS_UNAVAILABLE })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.resolveAttachment).not.toHaveBeenCalled()
  })

  it('rechecks the current invocation after asynchronous Agent resolution', async () => {
    fixture = await parseJobsFixture()
    fixture.grant()
    const gate = deferred<void>()
    const entered = deferred<void>()
    const original = fixture.ctx.sessionController.resolveAgent.bind(fixture.ctx.sessionController)
    vi.spyOn(fixture.ctx.sessionController, 'resolveAgent').mockImplementation(async (id) => {
      entered.resolve()
      await gate.promise
      return await original(id)
    })
    const started = fixture.helper.startDocumentParse(
      parseRequest(),
      parseSignal(),
      fixture.guestContext(),
    )
    await entered.promise
    fixture.revoke()
    gate.resolve()
    await expect(started).rejects.toMatchObject({ code: 'remote-access/denied' })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(SessionId('parse-owner'))).toEqual([])
  })

  it('replays one operation as the same job and rejects changed target, action, or config', async () => {
    const task = deferred<void>()
    fixture = await parseJobsFixture({
      execute: async (execution) => {
        await task.promise
        return parsedResult(execution)
      },
    })
    const request = parseRequest()
    const [first, replay] = await Promise.all([
      fixture.helper.startDocumentParse(request, parseSignal()),
      fixture.helper.startDocumentParse(request, parseSignal()),
    ])
    expect(replay.jobId).toBe(first.jobId)
    expect(fixture.ctx.jobs.list(SessionId('parse-owner'))).toHaveLength(1)
    await expect(
      fixture.helper.startDocumentParse({ ...request, action: 'reparse' }, parseSignal()),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT })
    await expect(
      fixture.helper.startDocumentParse(
        { ...request, target: { kind: 'url', url: 'https://other.example.org/document.pdf' } },
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT })
    fixture.config.value = { ...fixture.config.value, mode: 'pro' }
    await expect(fixture.helper.startDocumentParse(request, parseSignal())).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_OPERATION_CONFLICT,
    })
    task.resolve()
    await settled(fixture, first.jobId)
  })

  it('persists a bounded sanitized receipt across helper remounts without leaking another session', async () => {
    fixture = await parseJobsFixture({
      execute: async (execution) =>
        parsedResult(
          execution,
          'Bearer secret-value https://cdn.example.org/secret?sig=private /Users/xu/private/file.pdf\n' +
            'Authorization: Bearer header-private `/Users/xu/inline.pdf` [doc](/private/document.pdf)\n' +
            'evidence '.repeat(1000),
        ),
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await settled(fixture, started.jobId)
    await fixture.helper.dispose()
    const remounted = fixture.remount()
    const receipt = await remounted.documentParseReceipt(
      { sessionId: request.sessionId, operationId: request.operationId },
      parseSignal(),
    )
    expect(receipt.kind).toBe('completed')
    if (receipt.kind !== 'completed') throw new Error('Expected a completed receipt')
    expect(receipt.receipt.preview.length).toBeLessThanOrEqual(4096)
    expect(receipt.receipt.preview).not.toMatch(
      /secret-value|header-private|cdn\.example|\/Users\/|\/private\/|private-source/,
    )
    const replay = await remounted.startDocumentParse(request, parseSignal())
    expect(replay.jobId).toBe(started.jobId)
    expect(replay.status).toBe('completed')
    await expect(
      remounted.documentParseReceipt(
        { sessionId: 'parse-other', operationId: request.operationId },
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: ZOTERO_NOT_FOUND })
    expect(() => fixture!.ctx.jobs.kill(JobId(started.jobId), SessionId('parse-other'))).toThrow()
    const records = await Promise.all(
      (await readdir(join(fixture.root, 'parse-jobs'))).map(
        async (name) => await readFile(join(fixture!.root, 'parse-jobs', name), 'utf8'),
      ),
    )
    expect(records.join('\n')).not.toMatch(
      /private-source|secret-value|\/Users\/|cdn\.example|"outputDir"/,
    )
  })

  it('reads existing artifacts with uploads disabled without starting any parse', async () => {
    fixture = await parseJobsFixture()
    const request = parseRequest()
    fixture.lookup.mockImplementation(async (input, config) => ({
      kind: 'hit',
      text: '# Existing',
      format: 'markdown',
      source: 'MinerU',
      provenance: parsedResult({ input, config, generation: randomUUID() }).provenance,
    }))
    fixture.config.value = { ...fixture.config.value, allowDocumentUpload: false }
    expect(
      await fixture.helper.documentArtifact(
        { sessionId: request.sessionId, target: request.target },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'ready', characterCount: 10 })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(SessionId('parse-owner'))).toEqual([])
  })
})
