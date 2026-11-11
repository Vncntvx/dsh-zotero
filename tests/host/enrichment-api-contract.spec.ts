/**
 * Synthetic MinerU v1/v4 wire contracts checked against the official API docs
 * (2026-11-10). Real transport, parse orchestration and disk receipts run with
 * scripted fetch responses; no request leaves this process.
 * @module tests/host/enrichment-api-contract
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zipSync } from 'fflate'
import { ParsedArtifactStore } from '../../src/enrichment/artifact-store.ts'
import { cacheKeyOf, ParseFlight, parseOnce } from '../../src/enrichment/parse-once.ts'
import { MineruClient } from '../../src/enrichment/transport.ts'
import {
  freeStatus,
  freeSubmit,
  proStatus,
  proSubmit,
  responseData,
} from '../../src/enrichment/api.ts'

const bytes = new TextEncoder().encode('%PDF-1.7 synthetic contract input')
const input = {
  identity: 'https://example.org/paper.pdf?version=1#page=2',
  generation: '7e8148b0-924e-4d05-9c87-1d56792df325',
  bytes,
  mode: 'free' as const,
}
const sourceId = createHash('sha256')
  .update('https://example.org/paper.pdf?version=1')
  .digest('hex')
const fingerprint = createHash('sha256').update(bytes).digest('hex')
const timing = { pollIntervalMs: 0, maxPolls: 1 }
const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  )
})
async function storeOf() {
  const root = await mkdtemp(join(tmpdir(), 'mineru-contract-'))
  roots.push(root)
  return new ParsedArtifactStore(root)
}
function clientOf(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  return new MineruClient({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    dispatcher: () => ({ dispatcher: {} as never, close: async () => {} }),
    fetch,
  })
}
const json = (value: unknown) => new Response(JSON.stringify(value))

describe('MinerU response contracts', () => {
  it.each([
    ['missing envelope code', {}, freeSubmit],
    [
      'invalid success code type',
      { code: '0', data: { task_id: 't', file_url: 'https://oss.example/u' } },
      freeSubmit,
    ],
    ['empty signed URL list', { code: 0, data: { batch_id: 'b', file_urls: [] } }, proSubmit],
    [
      'multiple signed URLs',
      {
        code: 0,
        data: { batch_id: 'b', file_urls: ['https://oss.example/1', 'https://oss.example/2'] },
      },
      proSubmit,
    ],
    [
      'unsafe signed URL',
      { code: 0, data: { task_id: 't', file_url: 'http://oss.example/u' } },
      freeSubmit,
    ],
    ['unknown free state', { code: 0, data: { task_id: 't', state: 'complete' } }, freeStatus],
    [
      'multiple precise files',
      {
        code: 0,
        data: {
          batch_id: 'b',
          extract_result: [
            { file_name: 'a', state: 'pending' },
            { file_name: 'b', state: 'pending' },
          ],
        },
      },
      proStatus,
    ],
  ])('rejects %s', (_name, body, schema) => {
    expect(() => responseData(body, schema as never, 'contract')).toThrow()
  })

  it('accepts inactive output fields and all documented intermediate states', () => {
    for (const state of ['waiting-file', 'uploading', 'pending', 'running']) {
      expect(
        responseData(
          {
            code: 0,
            data: { task_id: 't', state, markdown_url: '', err_msg: null, err_code: null },
          },
          freeStatus,
          'poll',
        ).state,
      ).toBe(state)
    }
    for (const state of ['waiting-file', 'pending', 'running', 'converting']) {
      expect(
        responseData(
          {
            code: 0,
            data: {
              batch_id: 'b',
              extract_result: [
                {
                  file_name: 'document.pdf',
                  state,
                  full_zip_url: '',
                  err_msg: '',
                  extract_progress: null,
                },
              ],
            },
          },
          proStatus,
          'poll',
        ).extract_result[0]?.state,
      ).toBe(state)
    }
  })

  it('preserves API error and trace identifiers while redacting signed URLs and Bearer credentials', () => {
    const body = {
      code: 'A0211',
      msg: 'expired Bearer secret at https://oss.example/u?Signature=secret',
      trace_id: 'trace-1',
    }
    expect(() => responseData(body, freeSubmit, 'submit')).toThrow(/A0211.*trace-1/)
    expect(() => responseData(body, freeSubmit, 'submit')).toThrow(
      expect.not.stringContaining('secret'),
    )
  })
})

describe('MinerU durable tasks', () => {
  it('rejects a legacy artifact instead of contacting MinerU or repairing it', async () => {
    const store = await storeOf()
    const dir = join(store.root, cacheKeyOf(input))
    await mkdir(dir)
    const legacy = JSON.stringify({
      identity: input.identity,
      mode: 'free',
      contentFingerprint: fingerprint,
      taskId: 'legacy',
      files: ['full.md'],
    })
    await writeFile(join(dir, 'meta.json'), legacy)
    await writeFile(join(dir, 'full.md'), '# Legacy')
    const fetch = vi.fn(async () => {
      throw new Error('must not request MinerU after a cache protocol error')
    })
    await expect(
      parseOnce(input, { client: clientOf(fetch), store, flight: new ParseFlight(), timing }),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    expect(await readFile(join(dir, 'meta.json'), 'utf8')).toBe(legacy)
    expect(await readdir(store.root)).toEqual([cacheKeyOf(input)])
  })

  it('submits a new generation for identical bytes and retains the successful artifact when it fails', async () => {
    const store = await storeOf()
    let submits = 0
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        submits++
        return json({
          code: 0,
          data: { task_id: `task-${submits}`, file_url: 'https://oss.example/u' },
        })
      }
      if (init?.method === 'PUT') {
        expect(init.body).toEqual(bytes)
        return new Response(null)
      }
      if (url.endsWith('/agent/parse/task-1'))
        return json({
          code: 0,
          data: { task_id: 'task-1', state: 'done', markdown_url: 'https://cdn.example/full.md' },
        })
      if (url.endsWith('/agent/parse/task-2'))
        return json({
          code: 0,
          data: { task_id: 'task-2', state: 'failed', err_msg: 'page limit exceeded' },
        })
      if (url === 'https://cdn.example/full.md') return new Response('# Successful generation')
      throw new Error(`unexpected ${url}`)
    })
    const deps = { client: clientOf(fetch), store, flight: new ParseFlight(), timing }
    const first = await parseOnce(input, deps)
    expect(first).toMatchObject({
      artifact: { markdown: '# Successful generation' },
      cacheKey: cacheKeyOf(input),
      cached: false,
    })
    const committed = await store.get(first.cacheKey)
    expect(committed?.markdown).toBe('# Successful generation')
    expect(committed?.meta).toEqual({
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId,
      generation: input.generation,
      identity: 'https://example.org/…',
      mode: 'free',
      contentFingerprint: fingerprint,
      taskId: 'task-1',
      files: ['full.md'],
    })

    const next = { ...input, generation: 'f05ae92a-7ed7-4f86-9a13-1051122dfdeb' }
    const nextKey = cacheKeyOf(next)
    expect(nextKey).not.toBe(first.cacheKey)
    await expect(parseOnce(next, deps)).rejects.toMatchObject({ taskId: 'task-2' })
    expect(await store.get(nextKey)).toBeUndefined()
    expect(await store.getTask(nextKey)).toBeUndefined()
    expect(await store.get(first.cacheKey)).toEqual(committed)
    await expect(parseOnce(input, deps)).resolves.toEqual({
      artifact: committed,
      cacheKey: first.cacheKey,
      cached: true,
    })
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2)
  })

  it('resumes polling after an interrupted read without resubmitting or reuploading', async () => {
    const store = await storeOf()
    let finish = false
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return json({
          code: 0,
          data: { task_id: 'task-1', file_url: 'https://oss.example/u?Signature=secret' },
        })
      if (init?.method === 'PUT') return new Response(null)
      if (url.includes('/agent/parse/task-1'))
        return json({
          code: 0,
          data: {
            task_id: 'task-1',
            state: finish ? 'done' : 'running',
            markdown_url: finish ? 'https://cdn.example/full.md' : '',
          },
        })
      return new Response('# A short valid document')
    })
    const client = clientOf(fetch)
    await expect(
      parseOnce(input, { client, store, flight: new ParseFlight(), timing }),
    ).rejects.toThrow('did not finish')
    const receipt = await readFile(join(store.root, 'tasks', `${cacheKeyOf(input)}.json`), 'utf8')
    expect(JSON.parse(receipt)).toMatchObject({ taskId: 'task-1', uploaded: true })
    expect(receipt).not.toContain('Signature')
    finish = true
    // A new store and flight model a service restart.
    const result = await parseOnce(input, {
      client,
      store: new ParsedArtifactStore(store.root),
      flight: new ParseFlight(),
      timing,
    })
    expect(result).toMatchObject({
      artifact: { markdown: '# A short valid document' },
      cacheKey: cacheKeyOf(input),
      cached: false,
    })
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
    expect(await readdir(join(store.root, 'tasks'))).toEqual([])
  })

  it('sends exact precise requests and retains page totals reported before completion', async () => {
    const store = await storeOf()
    let polls = 0
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return json({
          code: 0,
          data: { batch_id: 'batch-1', file_urls: ['https://oss.example/u'] },
        })
      if (init?.method === 'PUT') return new Response(null)
      if (url.includes('/extract-results/')) {
        polls++
        return json({
          code: 0,
          data: {
            batch_id: 'batch-1',
            extract_result: [
              {
                file_name: 'document.pdf',
                state: polls === 1 ? 'running' : polls === 2 ? 'converting' : 'done',
                full_zip_url: polls === 3 ? 'https://cdn.example/result.zip' : '',
                ...(polls === 1
                  ? { extract_progress: { total_pages: 7, extracted_pages: 1 } }
                  : {}),
              },
            ],
          },
        })
      }
      return new Response(
        new Uint8Array(
          zipSync({
            'full.md': new TextEncoder().encode('# Parsed'),
            'document_content_list.json': new TextEncoder().encode('[]'),
          }),
        ).buffer,
      )
    })
    const client = clientOf(fetch)
    const result = await parseOnce(
      { ...input, mode: 'pro', token: 'secret-token' },
      { client, store, flight: new ParseFlight(), timing: { ...timing, maxPolls: 3 } },
    )
    expect(result.artifact.meta).toEqual({
      version: 2,
      parser: 'mineru',
      format: 'markdown',
      sourceId,
      generation: input.generation,
      identity: 'https://example.org/…',
      mode: 'pro',
      contentFingerprint: fingerprint,
      taskId: 'batch-1',
      files: ['full.md', 'content_list.json'],
      pageCount: 7,
    })
    expect(await store.get(result.cacheKey)).toEqual(result.artifact)
    expect(result.cacheKey).toBe(cacheKeyOf({ ...input, mode: 'pro' }))
    expect(result.cached).toBe(false)
    const submit = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(submit[0]).toBe('https://mineru.net/api/v4/file-urls/batch')
    expect(JSON.parse(submit[1]!.body as string)).toEqual({
      files: [{ name: 'document.pdf' }],
      model_version: 'vlm',
    })
    for (const [url, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(
        url.startsWith('https://mineru.net/') ? 'Bearer secret-token' : null,
      )
      if (init?.method === 'PUT') expect([...headers]).toEqual([])
    }
  })

  it('reports terminal task errors with identifiers and clears their receipts', async () => {
    const store = await storeOf()
    const client = clientOf(async (_url, init) => {
      if (init?.method === 'POST')
        return json({ code: 0, data: { task_id: 't1', file_url: 'https://oss.example/u' } })
      if (init?.method === 'PUT') return new Response(null)
      return json({
        code: 0,
        trace_id: 'trace-1',
        data: { task_id: 't1', state: 'failed', err_code: -30003, err_msg: 'page limit exceeded' },
      })
    })
    await expect(
      parseOnce(input, { client, store, flight: new ParseFlight(), timing }),
    ).rejects.toMatchObject({ apiCode: -30003, traceId: 'trace-1', taskId: 't1' })
    expect(await store.getTask(cacheKeyOf(input))).toBeUndefined()
  })

  it('refuses task identity mismatches before downloading any result', async () => {
    const store = await storeOf()
    await store.putTask(cacheKeyOf(input), {
      taskId: 'expected',
      createdAt: Date.now(),
      uploaded: true,
    })
    const fetch = vi.fn(async () =>
      json({
        code: 0,
        data: { task_id: 'wrong', state: 'done', markdown_url: 'https://cdn.example/full.md' },
      }),
    )
    await expect(
      parseOnce(input, { client: clientOf(fetch), store, flight: new ParseFlight(), timing }),
    ).rejects.toThrow('different task ID')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('MinerU task expiration and results', () => {
  it('clears an expired upload receipt without uploading or creating a replacement task', async () => {
    const store = await storeOf()
    await store.putTask(cacheKeyOf(input), {
      taskId: 'old',
      createdAt: Date.now() - 25 * 60 * 60_000,
      uploaded: false,
      uploadUrl: 'https://oss.example/u',
    })
    const fetch = vi.fn(async () => new Response(null))
    await expect(
      parseOnce(input, { client: clientOf(fetch), store, flight: new ParseFlight(), timing }),
    ).rejects.toThrow('expired')
    expect(fetch).not.toHaveBeenCalled()
    expect(await store.getTask(cacheKeyOf(input))).toBeUndefined()
  })

  it('clears a receipt when the precise API reports that its task no longer exists', async () => {
    const store = await storeOf()
    const precise = { ...input, mode: 'pro' as const, token: 'secret' }
    await store.putTask(cacheKeyOf(precise), {
      taskId: 'missing',
      createdAt: Date.now(),
      uploaded: true,
    })
    const client = clientOf(async () =>
      json({ code: -60012, msg: 'task does not exist', trace_id: 'trace-1' }),
    )
    await expect(
      parseOnce(precise, { client, store, flight: new ParseFlight(), timing }),
    ).rejects.toMatchObject({ apiCode: -60012, traceId: 'trace-1', taskId: 'missing' })
    expect(await store.getTask(cacheKeyOf(precise))).toBeUndefined()
  })

  it.each([
    ['missing result URL', '', undefined, 'without a Markdown URL'],
    ['HTML error page', 'https://cdn.example/full.md', '<html>bad gateway</html>', 'HTML/XML'],
    ['invalid UTF-8', 'https://cdn.example/full.md', new Uint8Array([0xff]), 'encoded data'],
  ])('refuses %s without committing an artifact', async (_label, markdownUrl, body, message) => {
    const store = await storeOf()
    await store.putTask(cacheKeyOf(input), {
      taskId: 'ready',
      createdAt: Date.now(),
      uploaded: true,
    })
    const client = clientOf(async (url) =>
      url.includes('/agent/parse/')
        ? json({ code: 0, data: { task_id: 'ready', state: 'done', markdown_url: markdownUrl } })
        : new Response(body),
    )
    await expect(
      parseOnce(input, { client, store, flight: new ParseFlight(), timing }),
    ).rejects.toThrow(message)
    expect(await store.get(cacheKeyOf(input))).toBeUndefined()
  })
})
