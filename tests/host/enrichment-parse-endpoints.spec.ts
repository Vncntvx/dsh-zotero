/**
 * Composition verification, not live Zotero/MinerU acceptance. Real Gateway,
 * RemoteAccess, jobs-local, core/provider, parseDocument/parseOnce and disk store;
 * Session-controller/Agent driving and external MinerU HTTP are controlled.
 * @module tests/host/enrichment-parse-endpoints
 */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.js'
import { parseDigest } from '../../src/enrichment/parse-target.js'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.js'
import {
  ZOTERO_ENRICHMENT_TASK_FAILED,
  ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT,
  ZOTERO_NOT_FOUND,
} from '../../src/errors.js'
import {
  zoteroDocumentArtifactResultSchema,
  zoteroDocumentParseReceiptResultSchema,
  zoteroStartDocumentParseResultSchema,
} from '../../src/wire-schemas.js'
import { attachmentRef } from '../helpers/server/keys.js'
import {
  DOCUMENT_URL,
  ENDPOINTS,
  MARKDOWN,
  OWNER,
  OTHER,
  PDF,
  endpointFixture,
  endpointRequest,
  startRequest,
  type EndpointFixture,
} from './support/enrichment-parse-endpoints.js'

const fixtures: EndpointFixture[] = []
async function setup(options: Parameters<typeof endpointFixture>[0] = {}) {
  const fixture = await endpointFixture(options)
  fixtures.push(fixture)
  return fixture
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.dispose()
  vi.restoreAllMocks()
})
function expectNoWork(fixture: EndpointFixture) {
  expect(fixture.http.calls).toEqual([])
  expect(fixture.lane.mock.requests).toEqual([])
  expect(fixture.resolved).not.toHaveBeenCalled()
  expect(fixture.started).not.toHaveBeenCalled()
  expect(fixture.ctx.jobs.list(OWNER)).toEqual([])
}

async function complete(fixture: EndpointFixture, request = startRequest(), peer = fixture.owner) {
  const started = zoteroStartDocumentParseResultSchema.parse(await fixture.start(request, peer))
  const job = await fixture.ctx.jobs.wait(JobId(started.jobId), 5000, OWNER)
  expect(job.status).toBe('completed')
  const result = zoteroDocumentParseReceiptResultSchema.parse(await fixture.receipt(peer))
  expect(result.kind).toBe('completed')
  if (result.kind !== 'completed') throw new Error('Parsing did not commit its receipt')
  return { started, job, receipt: result.receipt }
}

describe('explicit document parsing through the pinned Gateway', () => {
  it.each(ENDPOINTS)(
    '%s rejects an action outside its session role before source I/O',
    async (method) => {
      const fixture = await setup()
      const invoked = vi.spyOn(fixture.ctx.enrichment, method)
      fixture.grant(
        OWNER,
        ENDPOINTS.filter((allowed) => allowed !== method),
      )
      const failure = await fixture.failure(method, endpointRequest(method), fixture.guest)
      expect(invoked).not.toHaveBeenCalled()
      expect(failure.wire).toMatchObject({
        code: 'remote-access/denied',
        details: { action: `zotero/${method}`, reason: 'no-allow' },
      })
      expect(fixture.sessionCalls).toEqual([])
      expectNoWork(fixture)
    },
  )

  it.each(ENDPOINTS)('%s rejects another session before source I/O', async (method) => {
    const fixture = await setup()
    fixture.grant()
    const invoked = vi.spyOn(fixture.ctx.enrichment, method)
    const failure = await fixture.failure(method, endpointRequest(method, OTHER), fixture.guest)
    expect(invoked).not.toHaveBeenCalled()
    expect(failure.wire).toMatchObject({
      code: 'remote-access/denied',
      details: { action: `zotero/${method}`, reason: 'no-allow' },
    })
    expect(fixture.sessionCalls).toEqual([])
    expectNoWork(fixture)
  })

  it.each(ENDPOINTS)(
    '%s retains the invocation session check after global Gateway admission',
    async (method) => {
      const fixture = await setup()
      // This explicit host-boundary variation lets the real Gateway authorize
      // the action globally, proving the helper still sees the caller Context.
      fixture.removeSessionResource()
      fixture.grantGlobal()
      const invoked = vi.spyOn(fixture.ctx.enrichment, method)
      const failure = await fixture.failure(method, endpointRequest(method), fixture.guest)
      expect(invoked).toHaveBeenCalledOnce()
      expect(failure.wire).toMatchObject({
        code: 'remote-access/denied',
        details: { action: `zotero/${method}`, reason: 'no-allow' },
      })
      expect(fixture.sessionCalls).toEqual([])
      expectNoWork(fixture)
    },
  )

  it.each(ENDPOINTS)(
    '%s rejects undeclared wire fields before service execution',
    async (method) => {
      const fixture = await setup()
      const failure = await fixture.failure(method, {
        ...endpointRequest(method),
        bytes: [37, 80],
        path: '/private/document.pdf',
      })
      expect(failure.wire).toMatchObject({
        code: 'gateway/input-invalid',
        details: { endpoint: `zotero/${method}`, field: 'request' },
      })
      expect(fixture.sessionCalls).toEqual([])
      expectNoWork(fixture)
    },
  )

  it.each(['startDocumentParse', 'documentArtifact'] as const)(
    '%s rejects an open target arm before source I/O',
    async (method) => {
      const fixture = await setup()
      const failure = await fixture.failure(method, {
        ...endpointRequest(method),
        target: { kind: 'url', url: DOCUMENT_URL, headers: { authorization: 'synthetic' } },
      })
      expect(failure.wire).toMatchObject({
        code: 'gateway/input-invalid',
        details: { endpoint: `zotero/${method}`, field: 'request' },
      })
      expectNoWork(fixture)
    },
  )

  it('applies host public-address admission after the URL passes the wire codec', async () => {
    const fixture = await setup()
    const failure = await fixture.failure(
      'startDocumentParse',
      startRequest({ kind: 'url', url: 'http://127.0.0.1/document.pdf' }),
    )
    expect(failure.wire).toMatchObject({
      code: 'zotero/enrichment',
      details: { code: ZOTERO_ENRICHMENT_UNSUPPORTED_INPUT },
    })
    expectNoWork(fixture)
  })

  it('keeps ordinary lookup and all read endpoints passive before any submission', async () => {
    const fixture = await setup()
    fixture.grant()
    expect(
      await fixture.ctx.enrichment.enhancer.lookup({
        key: DOCUMENT_URL,
        source: { kind: 'url', url: DOCUMENT_URL },
        contentType: 'application/pdf',
      }),
    ).toEqual({ kind: 'miss', reason: 'absent' })
    expect(await fixture.artifact({ kind: 'url', url: DOCUMENT_URL }, fixture.guest)).toEqual({
      kind: 'missing',
    })
    const failure = await fixture.failure(
      'documentParseReceipt',
      endpointRequest('documentParseReceipt'),
      fixture.guest,
    )
    expect(failure.wire).toMatchObject({
      code: 'zotero/not-found',
      details: { code: ZOTERO_NOT_FOUND },
    })
    expectNoWork(fixture)
    expect(await readdir(fixture.root)).toEqual(['selected.pdf'])
  })

  it.each(['child', 'top', 'url'] as const)(
    'commits a selected %s PDF from an idle session-only peer and exposes it immediately',
    async (kind) => {
      const fixture = await setup(kind === 'url' ? {} : { attachment: kind })
      fixture.grant()
      expectNoWork(fixture)
      const target =
        kind === 'url'
          ? { kind: 'url' as const, url: `${DOCUMENT_URL}#page=3` }
          : fixture.attachmentTarget
      expect(fixture.agent.status).toBe('idle')
      expect(fixture.ctx.agents.get(OWNER)).toBe(fixture.agent)
      expect(fixture.ctx.agents.turnBoundaryOf(fixture.agent.session).openTurnStartSeq).toBeNull()
      const { started, receipt } = await complete(fixture, startRequest(target), fixture.guest)
      expect(started.status).toBe('started')
      expect(fixture.started).toHaveBeenCalledOnce()
      expect(fixture.started.mock.calls[0]![0]).toMatchObject({
        kind: 'zotero-enrichment',
        owner: OWNER,
      })
      expect(fixture.started.mock.calls[0]![0]).not.toHaveProperty('toolCall')
      const events = fixture.agent.session.snapshotEvents()
      expect(events.map(({ type }) => type)).toEqual(['job/registered', 'job/settled'])
      expect(events[0]?.data).toMatchObject({
        jobId: started.jobId,
        owner: OWNER,
        kind: 'zotero-enrichment',
      })
      expect(events[1]?.data).toMatchObject({ jobId: started.jobId, status: 'completed' })
      for (const event of events) expect(event.data).not.toHaveProperty('toolCall')
      expect(fixture.agent.send).not.toHaveBeenCalled()
      expect(fixture.agent.status).toBe('idle')
      expect(fixture.ctx.agents.turnBoundaryOf(fixture.agent.session).openTurnStartSeq).toBeNull()
      const identity = kind === 'url' ? DOCUMENT_URL : `${attachmentRef()}?server=S1`
      expect(receipt).toMatchObject({
        sourceId: parseDigest(identity),
        mode: 'free',
        cached: false,
        format: 'markdown',
        characterCount: MARKDOWN.length,
        preview: MARKDOWN,
      })
      expect(receipt.preview).not.toContain(fixture.root)
      const store = new ParsedArtifactStore(fixture.outputDir)
      expect(await store.get(receipt.artifactId)).toMatchObject({
        markdown: MARKDOWN,
        meta: {
          version: 2,
          sourceId: receipt.sourceId,
          generation: started.generation,
          parser: 'mineru',
          format: 'markdown',
        },
      })
      expect(await store.sourceRecord(sourceKeyOf(identity))).toMatchObject({
        cacheKey: receipt.artifactId,
        fingerprint: receipt.fingerprint,
      })
      expect(
        await readFile(join(fixture.outputDir, receipt.artifactId, 'meta.json'), 'utf8'),
      ).toContain(receipt.fingerprint)
      const parseCalls = fixture.http.calls.slice()
      const upload = parseCalls.find(({ init }) => init.method === 'PUT')
      expect(new Uint8Array(upload!.init.body as Uint8Array)).toEqual(PDF)
      expect(new Headers(upload!.init.headers).get('authorization')).toBeNull()
      expect(parseCalls.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
      if (kind === 'url') {
        expect(parseCalls[0]).toMatchObject({ url: DOCUMENT_URL, init: { method: 'GET' } })
        expect(fixture.resolved).not.toHaveBeenCalled()
      } else {
        expect(fixture.resolved).toHaveBeenCalled()
        expect(fixture.resolved.mock.calls.every(([ref]) => ref.startsWith(attachmentRef()))).toBe(
          true,
        )
        expect(
          fixture.lane.mock.requests.every(({ pathname }) =>
            pathname.startsWith('/api/users/0/items/WXYZ6789'),
          ),
        ).toBe(true)
        expect(parseCalls.some(({ url }) => url === DOCUMENT_URL)).toBe(false)
      }
      const input = {
        key: identity,
        source:
          kind === 'url'
            ? { kind: 'url' as const, url: DOCUMENT_URL }
            : { kind: 'local' as const, attachmentRef: identity },
        contentType: 'application/pdf',
      }
      const beforeLookup = fixture.http.calls.length
      expect(await fixture.ctx.enrichment.enhancer.lookup(input)).toMatchObject({
        kind: 'hit',
        text: MARKDOWN,
        format: 'markdown',
        provenance: { artifactId: receipt.artifactId, fingerprint: receipt.fingerprint },
      })
      expect(fixture.http.calls.slice(beforeLookup).map(({ init }) => init.method)).toEqual(
        kind === 'url' ? ['HEAD'] : [],
      )
      const beforeArtifact = fixture.http.calls.length
      const artifact = zoteroDocumentArtifactResultSchema.parse(
        await fixture.artifact(target, fixture.guest),
      )
      expect(artifact).toMatchObject({
        kind: 'ready',
        sourceId: receipt.sourceId,
        artifactId: receipt.artifactId,
        fingerprint: receipt.fingerprint,
        characterCount: MARKDOWN.length,
      })
      expect(artifact).not.toHaveProperty('markdown')
      expect(artifact).not.toHaveProperty('page')
      expect(fixture.http.calls.slice(beforeArtifact).map(({ init }) => init.method)).toEqual(
        kind === 'url' ? ['HEAD'] : [],
      )
      expect(await fixture.receipt(fixture.guest)).toEqual({ kind: 'completed', receipt })
      expect(fixture.started).toHaveBeenCalledOnce()
      expect(fixture.http.calls.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
      for (const { init } of fixture.http.calls)
        expect(new Headers(init.headers).get('authorization')).toBeNull()
    },
  )

  it('pages one artifact by character offset without exposing a path or URL', async () => {
    const fixture = await setup()
    fixture.grant()
    await complete(fixture, startRequest(), fixture.guest)
    const target = { kind: 'url' as const, url: DOCUMENT_URL }
    const first = zoteroDocumentArtifactResultSchema.parse(
      await fixture.open(target, fixture.guest),
    )
    expect(first).toMatchObject({ kind: 'opened', characterCount: MARKDOWN.length })
    if (first.kind !== 'opened') throw new Error('expected a page')
    expect(first.page).toEqual({ offset: 0, text: MARKDOWN, totalChars: MARKDOWN.length })
    const past = zoteroDocumentArtifactResultSchema.parse(
      await fixture.page(first.lease, MARKDOWN.length, fixture.guest),
    )
    if (past.kind !== 'page') throw new Error('expected a page')
    // Reading past the end yields an empty page rather than an unbounded body.
    expect(past.page).toEqual({
      offset: MARKDOWN.length,
      text: '',
      totalChars: MARKDOWN.length,
    })
    expect(JSON.stringify(first)).not.toContain('/tmp')
  })

  it('serves one stored figure by the reference the Markdown carries', async () => {
    const fixture = await setup()
    fixture.grant()
    const { receipt } = await complete(fixture, startRequest(), fixture.guest)
    // A figure beside the Markdown, committed the way the parser commits them.
    const directory = join(fixture.outputDir, receipt.artifactId)
    const metaPath = join(directory, 'meta.json')
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    await mkdir(join(directory, 'images'), { recursive: true })
    await writeFile(join(directory, 'images', 'page_0_figure.png'), bytes)
    await writeFile(
      metaPath,
      JSON.stringify({
        ...meta,
        images: [{ name: 'images/page_0_figure.png', mediaType: 'image/png', bytes: bytes.length }],
      }),
    )
    const target = { kind: 'url' as const, url: DOCUMENT_URL }
    const opened = await fixture.open(target, fixture.guest)
    if (opened.kind !== 'opened') throw new Error('expected open')
    const figure = zoteroDocumentArtifactResultSchema.parse(
      await fixture.figure(opened.lease, 'images/page_0_figure.png', fixture.guest),
    )
    expect(figure).toEqual({
      kind: 'image',
      lease: opened.lease,
      artifactId: receipt.artifactId,
      name: 'images/page_0_figure.png',
      mediaType: 'image/png',
      base64: Buffer.from(bytes).toString('base64'),
    })
    await expect(fixture.figure(opened.lease, 'images/other.png', fixture.guest)).rejects.toThrow()
    expect(JSON.stringify(figure)).not.toContain(fixture.outputDir)
  })

  it('preserves a corrupt source-index error across the artifact Gateway without resubmission', async () => {
    const fixture = await setup()
    fixture.grant()
    await complete(fixture, startRequest(), fixture.guest)
    await writeFile(join(fixture.outputDir, 'sources', 'index.json'), '{corrupt')
    const before = fixture.http.calls.length
    const failure = await fixture.failure(
      'documentArtifact',
      endpointRequest('documentArtifact'),
      fixture.guest,
    )
    expect(failure.wire).toMatchObject({
      code: 'zotero/enrichment',
      details: { code: ZOTERO_ENRICHMENT_TASK_FAILED },
    })
    expect(failure.error).toMatchObject({
      cause: expect.objectContaining({
        code: ZOTERO_ENRICHMENT_TASK_FAILED,
        cause: expect.any(SyntaxError),
      }),
    })
    expect(fixture.http.calls).toHaveLength(before)
    expect(fixture.started).toHaveBeenCalledOnce()
  })
})
