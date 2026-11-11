/** Closed target inputs, canonical attachment identity, and bounded receipt filesystem access. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDigest } from '../../src/enrichment/parse-target.js'
import {
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_SERVER_MISMATCH,
} from '../../src/errors.js'
import type { ZoteroStartDocumentParseRequestView } from '../../src/contract.js'
import { attachmentRef, itemRef } from '../helpers/server/keys.js'
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
const owner = SessionId('parse-owner')

describe('explicit parse target and receipt boundary', () => {
  it.each([
    { kind: 'path', path: '/private/document.pdf' },
    { kind: 'bytes', bytes: [37, 80, 68, 70] },
    { kind: 'attachment', ref: attachmentRef(), path: '/private/document.pdf' },
    { kind: 'attachment', ref: itemRef() },
    { kind: 'url', url: 'file:///private/document.pdf' },
  ])(
    'refuses a non-closed target $kind before creating a job or probing a source',
    async (target) => {
      fixture = await parseJobsFixture()
      // Deliberately malformed wire input exercises the production closed union.
      const request = {
        ...parseRequest(),
        target,
      } as unknown as ZoteroStartDocumentParseRequestView
      await expect(fixture.helper.startDocumentParse(request, parseSignal())).rejects.toMatchObject(
        { code: ZOTERO_INVALID_ARGUMENT },
      )
      expect(fixture.execute).not.toHaveBeenCalled()
      expect(fixture.resolveAttachment).not.toHaveBeenCalled()
      expect(fixture.ctx.jobs.list(owner)).toEqual([])
    },
  )

  it.each([
    'http://127.0.0.1/document.pdf',
    'https://host.local/document.pdf',
    'https://papers.example.org:3000/document.pdf',
  ])('refuses non-public URL %s before jobs or source acquisition', async (url) => {
    fixture = await parseJobsFixture()
    await expect(
      fixture.helper.startDocumentParse(
        parseRequest(undefined, { target: { kind: 'url', url } }),
        parseSignal(),
      ),
    ).rejects.toMatchObject({ code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.ctx.jobs.list(owner)).toEqual([])
  })

  it.each([
    {
      name: 'different library',
      response: { ref: 'zotero://group/42/attachment/WXYZ6789', contentType: 'application/pdf' },
      code: ZOTERO_INVALID_ARGUMENT,
    },
    {
      name: 'different attachment',
      response: { ref: attachmentRef('OTHR1234'), contentType: 'application/pdf' },
      code: ZOTERO_INVALID_ARGUMENT,
    },
    {
      name: 'different instance',
      response: { ref: `${attachmentRef()}?server=OTHER`, contentType: 'application/pdf' },
      code: ZOTERO_SERVER_MISMATCH,
    },
    {
      name: 'non-PDF',
      response: { ref: `${attachmentRef()}?server=S1`, contentType: 'text/html' },
      code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
    },
  ])('rejects a resolved $name without executing the parser', async ({ response, code }) => {
    fixture = await parseJobsFixture({
      resolveAttachment: async () => ({
        ...response,
        title: 'Selected',
        kind: 'file',
        path: '/private/document.pdf',
      }),
    })
    const request = parseRequest(undefined, {
      target: { kind: 'attachment', ref: `${attachmentRef()}?server=S1` },
    })
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    expect((await fixture.ctx.jobs.wait(JobId(started.jobId), 5000, owner)).status).toBe('failed')
    expect(
      await fixture.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'failed', code })
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('uses the same resolved attachment identity for start receipts and artifact status', async () => {
    const canonical = `${attachmentRef()}?server=S1`
    fixture = await parseJobsFixture({
      resolveAttachment: async () => ({
        ref: canonical,
        title: 'Canonical PDF',
        contentType: 'application/pdf',
        kind: 'file',
        path: '/private/document.pdf',
      }),
      lookup: async (input, config) =>
        input.key === canonical
          ? {
              kind: 'hit',
              text: 'Ready',
              format: 'markdown',
              source: 'MinerU',
              provenance: parsedResult({ input, config, generation: randomUUID() }).provenance,
            }
          : { kind: 'miss', reason: 'absent' },
    })
    const request = parseRequest(undefined, { target: fixture.attachment })
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    await fixture.ctx.jobs.wait(JobId(started.jobId), 5000, owner)
    const receipt = await fixture.helper.documentParseReceipt(
      { sessionId: request.sessionId, operationId: request.operationId },
      parseSignal(),
    )
    const status = await fixture.helper.documentArtifact(
      { sessionId: request.sessionId, target: request.target },
      parseSignal(),
    )
    expect(receipt).toMatchObject({
      kind: 'completed',
      receipt: { sourceId: parseDigest(canonical) },
    })
    expect(status).toMatchObject({
      kind: 'ready',
      sourceId: parseDigest(canonical),
      targetLabel: 'Canonical PDF',
    })
  })

  it('refuses a parsed result from a different generation instead of rewriting the admitted job', async () => {
    fixture = await parseJobsFixture({
      execute: async (execution) => parsedResult({ ...execution, generation: randomUUID() }),
    })
    const request = parseRequest()
    const started = await fixture.helper.startDocumentParse(request, parseSignal())
    expect((await fixture.ctx.jobs.wait(JobId(started.jobId), 5000, owner)).status).toBe('failed')
    expect(
      await fixture.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'failed', code: ZOTERO_ENRICHMENT_TASK_FAILED })
    const replay = await fixture.helper.startDocumentParse(request, parseSignal())
    expect(replay.generation).toBe(started.generation)
    expect(replay.jobId).toBe(started.jobId)
  })

  it('rejects a symlink receipt directory and leaves its sentinel untouched', async () => {
    fixture = await parseJobsFixture()
    const outside = join(fixture.root, 'outside')
    await mkdir(outside)
    const sentinel = join(outside, 'sentinel')
    await writeFile(sentinel, 'unchanged')
    await symlink(outside, join(fixture.root, 'parse-jobs'))
    const request = parseRequest()
    await expect(
      fixture.persistence.get(
        fixture.config.value,
        parseDigest(request.sessionId),
        request.operationId,
      ),
    ).rejects.toThrow('Unsafe parsing receipt directory')
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
    expect(fixture.execute).not.toHaveBeenCalled()
  })

  it('rejects an oversized receipt before decoding it', async () => {
    fixture = await parseJobsFixture()
    const request = parseRequest()
    const ownerHash = parseDigest(request.sessionId)
    const name = parseDigest(JSON.stringify([ownerHash, request.operationId]))
    await mkdir(join(fixture.root, 'parse-jobs'))
    await writeFile(join(fixture.root, 'parse-jobs', `${name}.json`), 'x'.repeat(65537))
    await expect(
      fixture.persistence.get(fixture.config.value, ownerHash, request.operationId),
    ).rejects.toThrow('Invalid parsing receipt file')
    expect(fixture.execute).not.toHaveBeenCalled()
  })
})
