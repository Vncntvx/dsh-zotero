import { afterEach, expect, it, vi } from 'vitest'
import { JournalMetrics } from '../../../src/library/journal-metrics.js'
import type { ZoteroJournalMetricsRequestView } from '../../../src/contract.js'
import { deferred } from '../../helpers/sync.js'

const secret = 'test-easyscholar-secret'
const ready = (all = { sci: 'Q1' }) => Response.json({ code: 200, data: { officialRank: { all } } })

function setup(fetch = vi.fn(async (_url: URL, _signal: AbortSignal) => ready())) {
  let reference: string | undefined = 'EASYSCHOLAR_SECRET_KEY'
  let credential: string | undefined = secret
  const service = new JournalMetrics({
    reference: () => reference,
    credential: async () => credential,
    fetch,
  })
  services.push(service)
  return {
    service,
    fetch,
    lookup: (
      publicationName: string,
      priority: ZoteroJournalMetricsRequestView['priority'] = 'list',
      signal?: AbortSignal,
    ) => service.lookup({ publicationName, priority }, signal),
    disable: () => {
      reference = undefined
      service.sync()
    },
    setCredential: (key: string | undefined, announce = true) => {
      credential = key
      if (reference && announce) service.credentialChanged(reference)
    },
  }
}
const services: JournalMetrics[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  vi.useRealTimers()
})

function useTime() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
}

it('shares one request per journal and serves cached results', async () => {
  const { lookup, fetch } = setup()
  const results = await Promise.all([
    lookup('Cafe\u0301 & Science'),
    lookup('Café & Science', 'detail'),
  ])
  expect(results[0]).toEqual(results[1])
  expect(results[0]).toMatchObject({ status: 'ready', official: [{ field: 'sci', value: 'Q1' }] })
  const url = fetch.mock.calls[0]![0]
  expect(url.origin + url.pathname).toBe('https://www.easyscholar.cc/open/getPublicationRank')
  expect(url.searchParams.get('publicationName')).toBe('Café & Science')
  expect(url.searchParams.get('secretKey')).toBe(secret)
  await lookup('Café & Science')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('refreshes successful results after the six-hour cache window', async () => {
  useTime()
  const { lookup, fetch } = setup()
  const first = await lookup('journal')
  await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 - 1)
  expect(await lookup('journal')).toBe(first)
  await vi.advanceTimersByTimeAsync(1)
  await expect(lookup('journal')).resolves.toMatchObject({
    status: 'ready',
    fetchedAt: Date.now(),
  })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('spaces starts 500 ms apart and runs queued detail work ahead of list work', async () => {
  useTime()
  const starts: [string | null, number][] = []
  const { lookup } = setup(
    vi.fn(async (url) => {
      starts.push([url.searchParams.get('publicationName'), performance.now()])
      return ready()
    }),
  )
  const waiting = [
    lookup('first'),
    lookup('second'),
    lookup('selected'),
    lookup('selected', 'detail'),
  ]
  await vi.advanceTimersByTimeAsync(999)
  expect(starts).toEqual([
    ['first', 0],
    ['selected', 500],
  ])
  await vi.advanceTimersByTimeAsync(1)
  await Promise.all(waiting)
  expect(starts).toEqual([
    ['first', 0],
    ['selected', 500],
    ['second', 1000],
  ])
})

it('cancels unused queued work and invalidates in-flight work on credential or policy changes', async () => {
  useTime()
  const { lookup, fetch, setCredential, disable } = setup()
  await lookup('first')
  const leave = new AbortController()
  const cancelled = expect(lookup('ignored', 'list', leave.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  await vi.advanceTimersByTimeAsync(0)
  leave.abort()
  await cancelled
  const revoked = lookup('revoked')
  await vi.advanceTimersByTimeAsync(0)
  setCredential('replacement-secret')
  await expect(revoked).resolves.toEqual({ status: 'disabled' })
  const fresh = lookup('first')
  await vi.advanceTimersByTimeAsync(500)
  await expect(fresh).resolves.toMatchObject({ status: 'ready' })
  expect(fetch.mock.calls.map(([url]) => url.searchParams.get('secretKey'))).toEqual([
    secret,
    'replacement-secret',
  ])
  disable()
  await expect(lookup('first')).resolves.toEqual({ status: 'disabled' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('distinguishes missing credentials and provider failure from a successful empty result', async () => {
  useTime()
  const { lookup, fetch, setCredential } = setup()
  setCredential(undefined)
  await expect(lookup('journal')).resolves.toEqual({ status: 'credential' })
  expect(fetch).not.toHaveBeenCalled()
  setCredential(secret)
  fetch
    .mockResolvedValueOnce(Response.redirect('https://example.org/'))
    .mockResolvedValueOnce(ready(Object.create(null)))
  await expect(lookup('journal')).resolves.toEqual({ status: 'invalidResponse' })
  const next = lookup('journal')
  await vi.advanceTimersByTimeAsync(500)
  await expect(next).resolves.toMatchObject({ status: 'ready', official: [], custom: [] })
})

it.each([
  ['HTTP refusal', () => new Response(null, { status: 403 }), 'credential'],
  ['HTTP rejection', () => new Response(null, { status: 400 }), 'requestRejected'],
  ['HTTP server error', () => new Response(null, { status: 503 }), 'serviceUnavailable'],
  ['provider missing key', () => Response.json({ code: 40005, msg: '密钥不能为空' }), 'credential'],
  ['provider key error', () => Response.json({ code: 40002, msg: 'Key错误' }), 'credential'],
  [
    'provider parameter error',
    () => Response.json({ code: 40002, msg: '参数错误' }),
    'requestRejected',
  ],
  [
    'malformed official results',
    () => Response.json({ code: 200, data: { officialRank: { all: [] } } }),
    'invalidResponse',
  ],
  [
    'malformed custom results',
    () => Response.json({ code: 200, data: { customRank: { rankInfo: [] } } }),
    'invalidResponse',
  ],
  ['non-JSON success', () => new Response('sign in'), 'invalidResponse'],
  ['missing response code', () => Response.json({ data: null }), 'invalidResponse'],
  ['missing success data', () => Response.json({ code: 200 }), 'invalidResponse'],
  ['oversized success', () => new Response('a'.repeat(128 * 1024 + 1)), 'invalidResponse'],
] as const)('classifies %s without caching it', async (_name, response, status) => {
  useTime()
  const { lookup, fetch } = setup()
  fetch.mockResolvedValueOnce(response())
  await expect(lookup('journal')).resolves.toEqual({ status })
  const retry = lookup('journal')
  await vi.advanceTimersByTimeAsync(500)
  await expect(retry).resolves.toMatchObject({ status: 'ready' })
})

it('caches a successful lookup with null official rankings and no custom matches', async () => {
  const { lookup, fetch } = setup()
  fetch.mockResolvedValueOnce(
    Response.json({
      code: 200,
      msg: 'SUCCESS',
      data: {
        officialRank: { all: null, select: null },
        customRank: { rankInfo: [{ uuid: '1234', abbName: 'Sample', oneRankText: 'A' }], rank: [] },
      },
    }),
  )
  const result = await lookup('Energy Procedia')
  expect(result).toMatchObject({ status: 'ready', official: [], custom: [] })
  await expect(lookup('Energy Procedia', 'detail')).resolves.toEqual(result)
  expect(fetch).toHaveBeenCalledOnce()
})

it('reports a connection failure without returning provider error text', async () => {
  const { lookup, fetch } = setup()
  fetch.mockRejectedValueOnce(new Error(`Cannot connect with ${secret}`))
  await expect(lookup('Journal')).resolves.toEqual({ status: 'connectionFailed' })
})

it('reports the request deadline as a timeout', async () => {
  useTime()
  const { lookup, fetch } = setup()
  fetch.mockImplementationOnce(
    async (_url, signal) =>
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  const pending = lookup('Journal')
  await vi.advanceTimersByTimeAsync(10_000)
  await expect(pending).resolves.toEqual({ status: 'timedOut' })
})

it('invalidates a cached result when the resolved key changes without an event', async () => {
  useTime()
  const { lookup, fetch, setCredential } = setup()
  await lookup('journal')
  setCredential('different-key', false)
  const next = lookup('journal')
  await vi.advanceTimersByTimeAsync(500)
  await expect(next).resolves.toMatchObject({ status: 'ready' })
  expect(fetch.mock.calls[1]?.[0].searchParams.get('secretKey')).toBe('different-key')
})

it('preserves a shared fetch after one caller leaves and aborts it for the last caller', async () => {
  const started = deferred<AbortSignal>()
  const { fetch, lookup } = setup(
    vi.fn(async (_url, signal) => {
      started.resolve(signal)
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }),
  )
  const list = new AbortController()
  const detail = new AbortController()
  const first = expect(lookup('journal', 'list', list.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  const second = expect(lookup('journal', 'detail', detail.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  const signal = await started.promise
  list.abort()
  await first
  expect(signal.aborted).toBe(false)
  detail.abort()
  await second
  expect(signal.aborted).toBe(true)
  expect(fetch).toHaveBeenCalledOnce()
})

it.each([
  ['seconds', '2', 2000],
  ['date', 'Thu, 01 Jan 2026 00:00:02 GMT', 2000],
  ['missing', undefined, 30_000],
] as const)('honors Retry-After across queued journals (%s)', async (_name, retry, delay) => {
  useTime()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  const { lookup, fetch } = setup()
  fetch.mockResolvedValueOnce(
    new Response(null, { status: 429, headers: retry ? { 'retry-after': retry } : {} }),
  )
  const first = lookup('first')
  const next = lookup('second')
  await expect(first).resolves.toEqual({ status: 'rateLimited' })
  await vi.advanceTimersByTimeAsync(delay - 1)
  expect(fetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await expect(next).resolves.toMatchObject({ status: 'ready' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('rechecks policy after credential resolution and hides credential provider errors', async () => {
  const credential = deferred<string>()
  const fetch = vi.fn()
  const resolve = vi.fn(() => credential.promise).mockRejectedValueOnce(new Error(secret))
  let reference: string | undefined = 'EASYSCHOLAR_SECRET_KEY'
  const service = new JournalMetrics({ reference: () => reference, credential: resolve, fetch })
  services.push(service)
  const lookup = (publicationName: string) => service.lookup({ publicationName, priority: 'list' })

  await expect(lookup('   ')).resolves.toEqual({ status: 'unavailable' })
  await expect(lookup('journal')).resolves.toEqual({ status: 'credential' })
  const pending = lookup('journal')
  expect(resolve).toHaveBeenCalledTimes(2)
  reference = undefined
  service.sync()
  credential.resolve(secret)
  await expect(pending).resolves.toEqual({ status: 'disabled' })
  expect(fetch).not.toHaveBeenCalled()
})

it('settles queued journals on provider quota exhaustion and lets a replacement key query', async () => {
  useTime()
  const { lookup, fetch, setCredential } = setup()
  await lookup('cached')
  fetch.mockResolvedValueOnce(
    Response.json({
      code: 40006,
      msg: '查询次数超过5万次，请您检查是否存在死循环，若是正常使用，可以联系客服清空次数。',
      data: null,
    }),
  )
  const first = lookup('first')
  const second = lookup('second')
  await vi.advanceTimersByTimeAsync(500)
  await expect(first).resolves.toEqual({ status: 'quotaExceeded' })
  await expect(second).resolves.toEqual({ status: 'quotaExceeded' })
  await expect(lookup('third')).resolves.toEqual({ status: 'quotaExceeded' })
  await expect(lookup('cached')).resolves.toMatchObject({ status: 'ready' })
  expect(fetch).toHaveBeenCalledTimes(2)
  setCredential('replacement')
  const resumed = lookup('third')
  await vi.advanceTimersByTimeAsync(500)
  await expect(resumed).resolves.toMatchObject({ status: 'ready' })
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('allows a manual quota recheck with the same key after one minute', async () => {
  useTime()
  const { lookup, fetch } = setup()
  fetch.mockResolvedValueOnce(Response.json({ code: 40006, data: null }))
  await expect(lookup('journal')).resolves.toEqual({ status: 'quotaExceeded' })
  await vi.advanceTimersByTimeAsync(59_999)
  await expect(lookup('journal')).resolves.toEqual({ status: 'quotaExceeded' })
  expect(fetch).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await expect(lookup('journal')).resolves.toMatchObject({ status: 'ready' })
})

it('bounds active and queued requests even when the provider never responds', async () => {
  useTime()
  const fetch = vi.fn(async (_url: URL, signal: AbortSignal) => {
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const { lookup, disable } = setup(fetch)
  const queued = Array.from({ length: 128 }, (_item, index) => lookup(`journal ${index}`))
  await vi.advanceTimersByTimeAsync(2000)
  expect(fetch).toHaveBeenCalledTimes(4)
  await expect(lookup('overflow')).resolves.toEqual({ status: 'unavailable' })
  disable()
  expect((await Promise.all(queued)).every(({ status }) => status === 'disabled')).toBe(true)
})
