/**
 * The parse orchestrator: submit → signed upload → poll → download → store,
 * cache reuse, the wire headers/timeouts, and the two failure classes (task
 * failure and poll exhaustion). The MinerU client is a scripted stub; no
 * socket opens. The single-flight coordinator has its own spec.
 * @module tests/host/enrichment-parse-once
 */

import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { ParseFlight, parseOnce, type ParseOnceDeps } from '../../src/enrichment/parse-once.ts'
import type { MineruClient } from '../../src/enrichment/transport.ts'
import type { ParsedArtifact } from '../../src/enrichment/types.ts'
import { ZOTERO_ENRICHMENT_TASK_FAILED } from '../../src/errors.ts'
import { SUBMIT_TIMEOUT_MS, UPLOAD_TIMEOUT_MS } from '../../src/enrichment/limits.ts'

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
  const record = (url: string, options: ScriptedOptions): void => {
    calls.push({
      url,
      method: options.method,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
  }
  const client = {
    async json(url: string, options: ScriptedOptions) {
      record(url, options)
      return handler(url, options)
    },
    async bytes(url: string, options: ScriptedOptions) {
      record(url, options)
      return handler(url, options)
    },
  } as unknown as MineruClient
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
    getTask: async () => undefined,
    putTask: async () => {},
    deleteTask: async () => {},
  } as unknown as ParseOnceDeps['store']
  return { store, put }
}

const context = {
  identity: 'zotero://user/0/attachment/ABCD',
  bytes: encoder.encode('%PDF-1.7 body'),
} as const

describe('parseOnce', () => {
  it('returns a cache hit without contacting MinerU', async () => {
    const hit: ParsedArtifact = {
      markdown: '# cached',
      meta: { identity: 'x', mode: 'free', contentFingerprint: 'f', taskId: 't', files: [] },
    }
    const { client, calls } = scriptedClient(() => {
      throw new Error('should not be called')
    })
    const { store } = storeOf(hit)
    await expect(
      parseOnce({ ...context, mode: 'free' }, { client, store, flight: new ParseFlight() }),
    ).resolves.toBe(hit)
    expect(calls).toHaveLength(0)
  })

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
      put: async () => {},
      getTask: async () => ({ taskId: 'resumed', createdAt: Date.now(), uploaded: true }),
      putTask: async () => {},
      deleteTask: async () => {},
    } as unknown as ParseOnceDeps['store']
    const artifact = await parseOnce(
      { ...context, mode: 'free' },
      { client, store, flight: new ParseFlight() },
    )
    expect(artifact.markdown).toContain('resumed')
    expect(artifact.meta.taskId).toBe('resumed')
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

    const artifact = await parseOnce(
      { ...context, mode: 'free' },
      { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 5 } },
    )
    expect(artifact.markdown).toBe('# Parsed Markdown')
    expect(artifact.meta.mode).toBe('free')
    expect(put).toHaveBeenCalledTimes(1)
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

    const artifact = await parseOnce(
      { ...context, mode: 'pro', token: 'secret' },
      { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 5 } },
    )
    expect(artifact.markdown).toBe('# Precise Markdown')
    expect(artifact.contentList).toBe('[{"type":"text"}]')
    expect(artifact.meta.pageCount).toBe(7)
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
    ).resolves.toMatchObject({ markdown: '# Eventually' })
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

  it('fails when the submit response is unreadable', async () => {
    const { client } = scriptedClient(() => ({ code: 1, msg: 'bad token' }))
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'free' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('bad token'),
    })
  })

  it('fails when the pro submit response is unreadable', async () => {
    const { client } = scriptedClient(() => ({ code: 1, msg: 'bad token' }))
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'pro', token: 'secret' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('precise submit'),
    })
  })

  it('fails when the free poll status is unreadable', async () => {
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v1/agent/parse/file')) {
        return { code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      return { code: 1 }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'free' },
        { client, store, flight: new ParseFlight(), timing: { pollIntervalMs: 1, maxPolls: 2 } },
      ),
    ).rejects.toMatchObject({
      code: ZOTERO_ENRICHMENT_TASK_FAILED,
      message: expect.stringContaining('request rejected'),
    })
  })

  it('fails when the pro poll status is unreadable', async () => {
    const { client } = scriptedClient((url) => {
      if (url.includes('/api/v4/file-urls/batch')) {
        return { code: 0, data: { batch_id: 'b1', file_urls: ['https://oss.example/u'] } }
      }
      if (url === 'https://oss.example/u') return new Uint8Array()
      return { code: 1 }
    })
    const { store } = storeOf()
    await expect(
      parseOnce(
        { ...context, mode: 'pro', token: 'secret' },
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
