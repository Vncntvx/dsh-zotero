/** Parse jobs composed with real acquisition, parseOnce, transport, artifact store and source pointer. */
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.js'
import { parseDocument } from '../../src/enrichment/parse-document.js'
import { ParseFlight } from '../../src/enrichment/parse-once.js'
import { EnrichmentService } from '../../src/enrichment/service.js'
import { MineruClient } from '../../src/enrichment/transport.js'
import { sourceKeyOf } from '../../src/enrichment/source-stamp.js'
import { ZOTERO_ENRICHMENT_TASK_FAILED } from '../../src/errors.js'
import type { ZoteroParseTargetView } from '../../src/contract.js'
import { attachmentRef } from '../helpers/server/keys.js'
import { deferred } from '../helpers/sync.js'
import {
  parseJobsFixture,
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
const PDF = new TextEncoder().encode('%PDF-1.7 synthetic job document')
const MARKDOWN = '# Verified parsed document\n\nThis is the parsed evidence.'

async function pipeline() {
  const calls: { url: string; init: RequestInit }[] = []
  let failResult = false
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init: init ?? {} })
    if (init?.method === 'HEAD') return new Response(null, { headers: { etag: '"pdf-1"' } })
    if (init?.method === 'POST')
      return Response.json({
        code: 0,
        data: {
          task_id: 'parse-task',
          file_url: 'https://upload.example.org/signed?secret=upload',
        },
      })
    if (init?.method === 'PUT') return new Response(null)
    if (url.includes('/api/v1/agent/parse/'))
      return Response.json({
        code: 0,
        data: {
          task_id: 'parse-task',
          state: 'done',
          markdown_url: 'https://cdn.example.org/result?secret=download',
        },
      })
    if (url.startsWith('https://cdn.example.org/'))
      return new Response(failResult ? '<html>upstream error</html>' : MARKDOWN)
    return new Response(PDF.slice().buffer, {
      headers: { etag: '"pdf-1"', 'content-type': 'application/pdf' },
    })
  })
  const client = new MineruClient({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    // The HTTP boundary is scripted; undici's dispatcher is never consumed.
    dispatcher: () => ({ dispatcher: {} as never, close: async () => {} }),
    fetch,
  })
  const flight = new ParseFlight()
  let store!: ParsedArtifactStore
  const host = await parseJobsFixture({
    execute: async ({ input, config, generation, signal, onProgress }) =>
      await parseDocument(
        input,
        {
          config,
          generation,
          client,
          flight,
          store: async () => store,
          resolveAttachment: async (ref, abort) => await host.resolveAttachment(ref, abort),
          resolveToken: async () => {
            throw new Error('Free parsing must not resolve credentials')
          },
          onProgress,
        },
        signal,
      ),
  })
  fixture = host
  store = new ParsedArtifactStore(host.root)
  const file = join(host.root, 'selected.pdf')
  await writeFile(file, PDF)
  host.resolveAttachment.mockImplementation(async (ref) => ({
    ref,
    title: 'Selected PDF',
    kind: 'file',
    path: file,
    contentType: 'application/pdf',
  }))
  return {
    ...host,
    calls,
    fetch,
    client,
    store,
    failResult: () => {
      failResult = true
    },
  }
}

async function receipt(host: ParseJobsFixture, request: ReturnType<typeof parseRequest>) {
  const started = await host.helper.startDocumentParse(request, parseSignal())
  expect(
    (await host.ctx.jobs.wait(JobId(started.jobId), 5000, SessionId(request.sessionId))).status,
  ).toBe('completed')
  const result = await host.helper.documentParseReceipt(
    { sessionId: request.sessionId, operationId: request.operationId },
    parseSignal(),
  )
  if (result.kind !== 'completed') throw new Error('Parsing must provide a committed receipt')
  return result.receipt
}

describe('parse job real document pipeline', () => {
  it.each([
    { label: 'child PDF attachment', target: { kind: 'attachment', ref: attachmentRef() } },
    {
      label: 'top-level PDF attachment',
      target: { kind: 'attachment', ref: attachmentRef('TOPP1234') },
    },
    {
      label: 'public URL',
      target: { kind: 'url', url: 'https://papers.example.org/source.pdf?access=private' },
    },
  ] satisfies { label: string; target: ZoteroParseTargetView }[])(
    'commits $label through parseDocument and makes its source-index artifact immediately readable',
    async ({ target }) => {
      const host = await pipeline()
      const result = await receipt(host, parseRequest(undefined, { target }))
      expect(result).toMatchObject({
        cached: false,
        format: 'markdown',
        characterCount: MARKDOWN.length,
        preview: MARKDOWN,
      })
      expect(result).not.toHaveProperty('pageCount')
      const key = target.kind === 'attachment' ? target.ref : target.url
      const pointer = await host.store.sourceRecord(sourceKeyOf(key))
      expect(pointer?.cacheKey).toBe(result.artifactId)
      expect(await host.store.get(result.artifactId)).toMatchObject({ markdown: MARKDOWN })
      expect(host.calls.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
      expect(host.calls.filter(({ init }) => init.method === 'PUT')).toHaveLength(1)
      for (const call of host.calls)
        expect(new Headers(call.init.headers).has('authorization')).toBe(false)
      if (target.kind === 'url') expect(host.resolveAttachment).not.toHaveBeenCalled()
      else expect(host.resolveAttachment.mock.calls.every(([ref]) => ref === target.ref)).toBe(true)
    },
  )

  it('reports the primary attachment source when artifact status reads its verified linked URL alias', async () => {
    const host = await pipeline()
    const url = 'https://papers.example.org/linked.pdf?signature=private'
    const ref = attachmentRef()
    host.resolveAttachment.mockImplementation(async (selected) => ({
      ref: selected,
      title: 'Linked PDF',
      kind: 'url',
      url,
      contentType: 'application/pdf',
    }))
    const parsed = await receipt(
      host,
      parseRequest(undefined, { target: { kind: 'attachment', ref } }),
    )
    const reader = new EnrichmentService(
      host.ctx,
      { ...host.config.value },
      { client: host.client, store: async () => host.store },
    )
    host.lookup.mockImplementation(
      async (input, _config, signal) => await reader.enhancer.lookup(input, signal),
    )
    host.calls.length = 0
    const status = await host.helper.documentArtifact(
      { sessionId: 'parse-owner', target: { kind: 'url', url } },
      parseSignal(),
    )
    expect(status).toMatchObject({
      kind: 'ready',
      artifactId: parsed.artifactId,
      sourceId: sourceKeyOf(ref),
    })
    expect(parsed.sourceId).toBe(sourceKeyOf(ref))
    expect(parsed.sourceId).not.toBe(sourceKeyOf(url))
    expect(host.calls.map(({ init }) => init.method)).toEqual(['HEAD'])
  })

  it('coalesces two owned jobs before the URL GET and submits only one MinerU task', async () => {
    const host = await pipeline()
    const blocked = deferred<void>()
    const entered = deferred<void>()
    const original = host.fetch.getMockImplementation()!
    host.fetch.mockImplementation(async (url, init) => {
      if (url.startsWith('https://papers.example.org/')) {
        entered.resolve()
        await blocked.promise
      }
      return await original(url, init)
    })
    const firstRequest = parseRequest()
    const first = await host.helper.startDocumentParse(firstRequest, parseSignal())
    await entered.promise
    const second = await host.helper.startDocumentParse(parseRequest('parse-other'), parseSignal())
    expect(second.generation).toBe(first.generation)
    blocked.resolve()
    expect(
      (await host.ctx.jobs.wait(JobId(first.jobId), 5000, SessionId('parse-owner'))).status,
    ).toBe('completed')
    expect(
      (await host.ctx.jobs.wait(JobId(second.jobId), 5000, SessionId('parse-other'))).status,
    ).toBe('completed')
    expect(host.calls.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
    expect(
      host.calls.filter(
        ({ url, init }) => url.startsWith('https://papers.example.org/') && init.method === 'GET',
      ),
    ).toHaveLength(1)
  })

  it('keeps publication failure failed when the last waiter is cancelled during its filesystem commit', async () => {
    const host = await pipeline()
    const initialRequest = parseRequest()
    const initial = await receipt(host, initialRequest)
    const publishing = deferred<void>()
    const commit = deferred<void>()
    vi.spyOn(host.store, 'putSources').mockImplementation(async () => {
      publishing.resolve()
      await commit.promise
      throw Object.assign(new Error('publication denied'), { code: 'EACCES' })
    })
    const request = parseRequest(undefined, { action: 'reparse' })
    const started = await host.helper.startDocumentParse(request, parseSignal())
    await publishing.promise
    host.ctx.jobs.kill(JobId(started.jobId), SessionId(request.sessionId))
    expect(host.ctx.jobs.get(JobId(started.jobId), SessionId(request.sessionId)).status).toBe(
      'stopping',
    )
    commit.resolve()
    expect(
      (await host.ctx.jobs.wait(JobId(started.jobId), 5000, SessionId(request.sessionId))).status,
    ).toBe('failed')
    expect(
      await host.helper.documentParseReceipt(
        { sessionId: request.sessionId, operationId: request.operationId },
        parseSignal(),
      ),
    ).toMatchObject({ kind: 'failed', code: ZOTERO_ENRICHMENT_TASK_FAILED })
    expect(
      (
        await host.store.sourceRecord(
          sourceKeyOf(
            initialRequest.target.kind === 'url'
              ? initialRequest.target.url
              : initialRequest.target.ref,
          ),
        )
      )?.cacheKey,
    ).toBe(initial.artifactId)
  })

  it('preserves the last good source pointer when a reparse fails result validation', async () => {
    const host = await pipeline()
    const firstRequest = parseRequest()
    const first = await receipt(host, firstRequest)
    host.failResult()
    const next = await host.helper.startDocumentParse(
      parseRequest(undefined, { action: 'reparse' }),
      parseSignal(),
    )
    expect(next.generation).not.toBe(first.generation)
    expect(
      (await host.ctx.jobs.wait(JobId(next.jobId), 5000, SessionId('parse-owner'))).status,
    ).toBe('failed')
    expect(
      (
        await host.store.sourceRecord(
          sourceKeyOf(
            firstRequest.target.kind === 'url' ? firstRequest.target.url : firstRequest.target.ref,
          ),
        )
      )?.cacheKey,
    ).toBe(first.artifactId)
    expect(await host.store.get(first.artifactId)).toMatchObject({ markdown: MARKDOWN })
  })
})
