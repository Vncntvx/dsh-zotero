/**
 * The parse orchestrator: submit → signed upload → poll → download → store,
 * cache reuse, the wire headers/timeouts, and the two failure classes (task
 * failure and poll exhaustion). The MinerU client is a scripted stub; no
 * socket opens. The single-flight coordinator has its own spec.
 * @module tests/host/enrichment-parse-once
 */

import { createHash } from 'node:crypto'
import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  cacheKeyOf,
  ParseFlight,
  parseOnce,
  type ParseOnceDeps,
} from '../../src/enrichment/parse-once.ts'
import type { MineruClient } from '../../src/enrichment/transport.ts'
import type { ParsedArtifact } from '../../src/enrichment/types.ts'
import { ZOTERO_ENRICHMENT_TASK_FAILED, ZOTERO_INVALID_ARGUMENT } from '../../src/errors.ts'
import { SUBMIT_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from '../../src/enrichment/limits.ts'
import { attachmentRef } from '../helpers/server/keys.ts'

const encoder = new TextEncoder()

interface ScriptedOptions {
  method: string
  body?: string | Uint8Array
  headers?: Record<string, string>
  timeoutMs?: number
}

interface RecordedCall {
  url: string
  method: string
  headers?: Record<string, string>
  timeoutMs?: number
}

/** A scripted client keyed by request method + URL substring. */
function scriptedClient(handler: (url: string, options: ScriptedOptions) => unknown): {
  client: MineruClient
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const request = async (url: string, options: ScriptedOptions): Promise<unknown> => {
    calls.push({
      url,
      method: options.method,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
    return handler(url, options)
  }
  const client = { json: request, bytes: request } as unknown as MineruClient
  return { client, calls }
}

function storeOf(hit?: ParsedArtifact): {
  store: ParseOnceDeps['store']
  put: ReturnType<typeof vi.fn>
} {
  const put = vi.fn(async () => {})
  const store = {
    root: '/test',
    get: async () => hit,
    put,
    putNormalized: put,
    getTask: async () => undefined,
    putTask: async () => {},
    deleteTask: async () => {},
  } as unknown as ParseOnceDeps['store']
  return { store, put }
}

const context = {
  identity: attachmentRef(),
  generation: '7e8148b0-924e-4d05-9c87-1d56792df325',
  bytes: encoder.encode('%PDF-1.7 body'),
} as const
const sourceId = createHash('sha256').update(context.identity).digest('hex')
const fingerprint = createHash('sha256').update(context.bytes).digest('hex')

describe('parseOnce', () => {
  it.each(['parse-job-1', '7e8148b0-924e-4d05-9c87-invalid'])(
    'rejects non-UUID generation %s before reading the store or contacting MinerU',
    async (generation) => {
      const { client, calls } = scriptedClient(() => {
        throw new Error('should not be called')
      })
      const { store, put } = storeOf()
      const get = vi.spyOn(store, 'get')
      await expect(
        parseOnce(
          { ...context, generation, mode: 'free' },
          { client, store, flight: new ParseFlight() },
        ),
      ).rejects.toMatchObject({ code: ZOTERO_INVALID_ARGUMENT })
      expect(get).not.toHaveBeenCalled()
      expect(put).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    },
  )

  it.each(['initial', 'shared-flight'])(
    'returns a cache hit from the %s lookup without contacting MinerU',
    async (lookup) => {
      const hit: ParsedArtifact = {
        markdown: '# cached',
        meta: {
          version: 2,
          parser: 'mineru',
          format: 'markdown',
          sourceId,
          generation: context.generation,
          identity: context.identity,
          mode: 'free',
          contentFingerprint: fingerprint,
          taskId: 't',
          files: ['full.md'],
        },
      }
      const { client, calls } = scriptedClient(() => {
        throw new Error('should not be called')
      })
      const { store, put } = storeOf(hit)
      if (lookup === 'shared-flight') vi.spyOn(store, 'get').mockResolvedValueOnce(undefined)
      const result = await parseOnce(
        { ...context, mode: 'free' },
        { client, store, flight: new ParseFlight() },
      )
      expect(result).toEqual({
        artifact: hit,
        cacheKey: cacheKeyOf({ ...context, mode: 'free' }),
        cached: true,
      })
      expect(result.artifact).toBe(hit)
      expect(put).not.toHaveBeenCalled()
      expect(calls).toHaveLength(0)
    },
  )

  it('resumes an already-uploaded task without re-submitting or uploading', async () => {
    // A receipt left by an earlier run: the task was submitted and uploaded,
    // but the process died before the parse finished. This run must go
    // straight to polling and never touch the submit or upload endpoints.
    const { client, calls } = scriptedClient((url) => {
      if (url.includes('/agent/parse/')) {
        return {
          code: 0,
          data: {
            task_id: 'resumed',
            state: 'done',
            markdown_url: 'https://cdn.example.com/full.md',
          },
        }
      }
      return Buffer.from('# resumed markdown body that is long enough')
    })
    const store = {
      root: '/test',
      get: async () => undefined,
      putNormalized: async () => {},
      getTask: async () => ({ taskId: 'resumed', createdAt: Date.now(), uploaded: true }),
      putTask: async () => {},
      deleteTask: async () => {},
    } as unknown as ParseOnceDeps['store']
    const { artifact, cacheKey, cached } = await parseOnce(
      { ...context, mode: 'free' },
      { client, store, flight: new ParseFlight() },
    )
    expect(artifact.markdown).toContain('resumed')
    expect(artifact.meta.taskId).toBe('resumed')
    expect(cacheKey).toBe(cacheKeyOf({ ...context, mode: 'free' }))
    expect(cached).toBe(false)
    // No submit (POST) and no PUT: only the poll GET and the result download.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0)
  })

  it('runs the free flow without a Content-Type on the signed upload', async () => {
    let polls = 0
    const { client, calls } = scriptedClient((url, options) => {
      if (url.includes('/api/v1/agent/parse/file')) {
        expect(options.method).toBe('POST')
        return { code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } }
      }
      if (url === 'https://oss.example/u') {
        expect(options.method).toBe('PUT')
        return new Uint8Array()
      }
      if (url.includes('/api/v1/agent/parse/t1')) {
        polls += 1
        return polls < 2
          ? { code: 0, data: { task_id: 't1', state: 'running' } }
          : {
              code: 0,
              data: { task_id: 't1', state: 'done', markdown_url: 'https://cdn.example/full.md' },
            }
      }
      if (url === 'https://cdn.example/full.md') {
        return encoder.encode('# Parsed Markdown')
      }
      throw new Error(`unexpected ${url}`)
    })
    const { store, put } = storeOf()

    const { artifact, cacheKey, cached } = await parseOnce(
      { ...context, mode: 'free' },
      { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 5 } },
    )
    expect(artifact.markdown).toBe('# Parsed Markdown')
    expect(artifact.meta).toEqual({
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId,
      generation: context.generation,
      identity: context.identity,
      mode: 'free',
      contentFingerprint: fingerprint,
      taskId: 't1',
      files: ['full.md'],
      title: 'Parsed Markdown',
    })
    expect(cacheKey).toBe(cacheKeyOf({ ...context, mode: 'free' }))
    expect(cached).toBe(false)
    expect(put).toHaveBeenCalledExactlyOnceWith(cacheKey, artifact)
    expect(calls.map((call) => call.method)).toEqual(['POST', 'PUT', 'GET', 'GET', 'GET'])
    const upload = calls.find((call) => call.method === 'PUT')
    expect(upload?.headers?.['content-type']).toBeUndefined()
    expect(upload?.headers).toBeUndefined()
    expect(upload?.timeoutMs).toBe(UPLOAD_TIMEOUT_MS)
    expect(calls[0]?.timeoutMs).toBe(SUBMIT_TIMEOUT_MS)
  })

  it('runs the pro flow and unpacks the result zip', async () => {
    const zip = zipSync({
      'full.md': encoder.encode('# Precise Markdown'),
      'doc_content_list.json': encoder.encode('[{"type":"text"}]'),
    })
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v4/file-urls/batch')) {
        return { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss.example/u'] } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      if (url.includes('/api/v4/extract-results/batch/b1')) {
        return {
          code: 0,
          data: {
            batch_id: 'b1',
            extract_result: [
              {
                file_name: 'document.pdf',
                state: 'done',
                full_zip_url: 'https://cdn.example/r.zip',
                extract_progress: { total_pages: 7 },
              },
            ],
          },
        }
      }
      if (url === 'https://cdn.example/r.zip') return zip
      throw new Error(`unexpected ${url}`)
    })
    const { store } = storeOf()

    const { artifact, cacheKey, cached } = await parseOnce(
      { ...context, mode: 'pro', token: 'secret' },
      { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 5 } },
    )
    expect(artifact.markdown).toBe('# Precise Markdown')
    expect(artifact.contentList).toBe('[{"type":"text"}]')
    expect(artifact.meta).toEqual({
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId,
      generation: context.generation,
      identity: context.identity,
      mode: 'pro',
      contentFingerprint: fingerprint,
      taskId: 'b1',
      files: ['full.md', 'content_list.json'],
      pageCount: 7,
      title: 'Precise Markdown',
    })
    expect(cacheKey).toBe(cacheKeyOf({ ...context, mode: 'pro' }))
    expect(cached).toBe(false)
  })

  it('treats an empty precise result list as pending, then completes', async () => {
    let polls = 0
    const zip = zipSync({ 'full.md': encoder.encode('# Eventually') })
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v4/file-urls/batch')) {
        return { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss.example/u'] } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      if (url.includes('/api/v4/extract-results/batch/b1')) {
        polls += 1
        return polls < 2
          ? { code: 0, data: { batch_id: 'b1', extract_result: [] } }
          : {
              code: 0,
              data: {
                batch_id: 'b1',
                extract_result: [
                  {
                    file_name: 'document.pdf',
                    state: 'done',
                    full_zip_url: 'https://cdn.example/r.zip',
                  },
                ],
              },
            }
      }
      if (url === 'https://cdn.example/r.zip') return zip
      throw new Error(`unexpected ${url}`)
    })
    const { store } = storeOf()

    await expect(
      parseOnce(
        { ...context, mode: 'pro', token: 'secret' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 5 } },
      ),
    ).resolves.toMatchObject({
      artifact: { markdown: '# Eventually', meta: { files: ['full.md'] } },
      cacheKey: cacheKeyOf({ ...context, mode: 'pro' }),
      cached: false,
    })
    expect(polls).toBe(2)
  })

  it('fails loudly when MinerU reports the task failed', async () => {
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v1/agent/parse/file')) {
        return { code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      return {
        code: 0,
        data: { task_id: 't1', state: 'failed', err_msg: 'file page count exceeds limit' },
      }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'free' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 5 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('file page count exceeds limit'),
    })
  })

  it('fails when polling never reaches a terminal state', async () => {
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v1/agent/parse/file')) {
        return { code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      return { code: 0, data: { task_id: 't1', state: 'running' } }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'free' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('did not finish within 2 polls'),
    })
  })

  it.each([
    { mode: 'free' as const, message: 'bad token' },
    { mode: 'pro' as const, message: 'precise submit' },
  ])('fails when the $mode submit response is unreadable', async ({ mode, message }) => {
    const { client } = scriptedClient(() => ({ code: 1, msg: 'bad token' }))
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode, ...(mode === 'pro' ? { token: 'secret' } : {}) },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining(message),
    })
  })

  it.each([
    {
      mode: 'free' as const,
      submitPath: '/api/v1/agent/parse/file',
      data: { task_id: 't1', file_url: 'https://oss.example/u' },
    },
    {
      mode: 'pro' as const,
      submitPath: '/api/v4/file-urls/batch',
      data: { batch_id: 'b1', file_urls: ['https://oss.example/u'] },
    },
  ])('fails when the $mode poll status is unreadable', async ({ mode, submitPath, data }) => {
    const { client } = scriptedClient((url) => {
      if (url.includes(submitPath)) return { code: 0, data }
      if (url === 'https://oss.example/u') return new Uint8Array()
      return { code: 1 }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode, ...(mode === 'pro' ? { token: 'secret' } : {}) },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('request rejected'),
    })
  })

  it('fails when the pro task reports failed', async () => {
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v4/file-urls/batch')) {
        return { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss.example/u'] } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      return {
        code: 0,
        data: {
          batch_id: 'b1',
          extract_result: [
            { file_name: 'document.pdf', state: 'failed', err_msg: 'page limit exceeded' },
          ],
        },
      }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'pro', token: 'secret' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('page limit exceeded'),
    })
  })

  it('rejects an empty Markdown download', async () => {
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v1/agent/parse/file')) {
        return { code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      if (url.includes('/api/v1/agent/parse/t1')) {
        return {
          code: 0,
          data: { task_id: 't1', state: 'done', markdown_url: 'https://cdn.example/full.md' },
        }
      }
      if (url === 'https://cdn.example/full.md') return new Uint8Array()
      throw new Error(`unexpected ${url}`)
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'free' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('empty Markdown'),
    })
  })

  it('propagates caller cancellation', async () => {
    const controller = new AbortController()
    const { client } = scriptedClient(() => {
      controller.abort(new Error('cancelled'))
      return { code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'free', signal: controller.signal },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toThrow('cancelled')
  })
})
