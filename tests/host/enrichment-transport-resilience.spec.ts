/** MinerU retry, deadline, concurrency and redirect contracts. @module tests/host/enrichment-transport-resilience */
import { describe, expect, it, vi } from 'vitest'
import { MineruClient } from '../../src/enrichment/transport.ts'
import { PublicAddressError } from '../../src/transport/public-url.ts'
import { deferred, progress } from '../helpers/sync.ts'
import { clientOf } from './support/mineru-transport.ts'

describe('MineruClient resilience', () => {
  it('honors a zero Retry-After and bounds idempotent retries', async () => {
    const { client, calls } = clientOf(
      async () =>
        new Response('{"code":-10001,"trace_id":"trace-1"}', {
          status: 429,
          headers: { 'retry-after': '0' },
        }),
    )
    await expect(
      client.json('https://mineru.net/api/v4/extract-results/batch/b1', { method: 'GET' }),
    ).rejects.toMatchObject({ status: 429, apiCode: -10001, traceId: 'trace-1' })
    expect(calls).toHaveLength(3)
  })

  it.each([429, 503])(
    'makes only one HEAD attempt after HTTP %i without falling back to GET',
    async (status) => {
      const { client, calls } = clientOf(
        async () => new Response(null, { status, headers: { 'retry-after': '0' } }),
      )
      await expect(
        client.head('https://cdn.example/source.pdf', { method: 'HEAD' }),
      ).rejects.toMatchObject({ status })
      expect(calls.map(({ init }) => init.method)).toEqual(['HEAD'])
    },
  )

  it('does not retry a HEAD network failure', async () => {
    const failure = new TypeError('offline')
    const { client, calls } = clientOf(async () => {
      throw failure
    })
    await expect(client.head('https://cdn.example/source.pdf', { method: 'HEAD' })).rejects.toBe(
      failure,
    )
    expect(calls.map(({ init }) => init.method)).toEqual(['HEAD'])
  })

  it.each(['get', 'head'] as const)(
    '%s retains caller cancellation until pinned connection cleanup finishes',
    async (method) => {
      const closing = deferred()
      const cleanup = deferred()
      const controller = new AbortController()
      const reason = new Error('cancelled during cleanup')
      let settled = false
      const close = vi.fn(async () => {
        closing.resolve()
        await cleanup.promise
      })
      const client = new MineruClient({
        resolver: async () => [{ address: '93.184.216.34', family: 4 }],
        dispatcher: () => ({ dispatcher: {} as never, close }),
        fetch: async () => new Response('done'),
      })
      const pending = client[method]('https://cdn.example/source.pdf', {
        method: 'GET',
        signal: controller.signal,
      }).finally(() => {
        settled = true
      })
      const rejected = expect(pending).rejects.toBe(reason)
      await closing.promise
      controller.abort(reason)
      expect(settled).toBe(false)
      cleanup.resolve()
      await rejected
      expect(close).toHaveBeenCalledTimes(1)
    },
  )

  it('does not replay a submission on service failure', async () => {
    const { client, calls } = clientOf(
      async () => new Response('unavailable', { status: 503, headers: { 'retry-after': '0' } }),
    )
    await expect(
      client.json('https://mineru.net/api/v4/file-urls/batch', { method: 'POST', token: 'secret' }),
    ).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })

  it('retries a signed PUT with identical bytes and no headers', async () => {
    let attempts = 0
    const { client, calls } = clientOf(async () =>
      ++attempts === 1
        ? new Response(null, { status: 503, headers: { 'retry-after': '0' } })
        : new Response(null),
    )
    const body = new Uint8Array([1, 2, 3])
    await client.bytes('https://oss.example/u', { method: 'PUT', body })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.init.body).toBe(body)
      expect(call.init.headers).toEqual({})
    }
  })

  it('refuses API redirects without forwarding a token', async () => {
    const { client, calls } = clientOf(
      async () =>
        new Response(null, { status: 307, headers: { location: 'https://cdn.example/u' } }),
    )
    await expect(
      client.json('https://mineru.net/api/v4/file-urls/batch', { method: 'POST', token: 'secret' }),
    ).rejects.toMatchObject({ status: 307 })
    expect(calls).toHaveLength(1)
  })

  it('refuses method-changing signed upload redirects', async () => {
    const { client, calls } = clientOf(
      async () =>
        new Response(null, { status: 302, headers: { location: 'https://oss.example/other' } }),
    )
    await expect(
      client.bytes('https://oss.example/u', { method: 'PUT', body: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ status: 302 })
    expect(calls).toHaveLength(1)
  })

  it('refuses a cleartext API origin before DNS or fetch', async () => {
    const { client, calls } = clientOf(async () => new Response('{}'))
    await expect(
      client.json('http://mineru.net/api/v4/file-urls/batch', { method: 'POST', token: 'secret' }),
    ).rejects.toBeInstanceOf(PublicAddressError)
    expect(calls).toEqual([])
  })

  it('bounds concurrent transfers and allows a queued caller to cancel', async () => {
    const release = deferred()
    const started = progress()
    let active = 0
    let peak = 0
    const { client, calls } = clientOf(async () => {
      active++
      peak = Math.max(peak, active)
      started.notify()
      await release.promise
      active--
      return new Response('done')
    })
    const pending = Array.from(
      { length: 4 },
      async () => await client.bytes('https://cdn.example/full.md', { method: 'GET' }),
    )
    await started.when(() => active === 4)
    const controller = new AbortController()
    const queued = client.bytes('https://cdn.example/full.md', {
      method: 'GET',
      signal: controller.signal,
    })
    const rejection = expect(queued).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await rejection
    release.resolve()
    await Promise.all(pending)
    expect(peak).toBe(4)
    expect(calls).toHaveLength(4)
  })

  it('refuses partial result bodies', async () => {
    const { client } = clientOf(async () => new Response('partial', { status: 206 }))
    await expect(
      client.bytes('https://cdn.example/full.md', { method: 'GET' }),
    ).rejects.toMatchObject({ status: 206 })
  })
})

describe('MineruClient retry deadlines', () => {
  it('bounds a server Retry-After by the original request deadline', async () => {
    const { client, calls } = clientOf(
      async () => new Response(null, { status: 429, headers: { 'retry-after': '60' } }),
    )
    await expect(
      client.bytes('https://cdn.example/full.md', { method: 'GET', timeoutMs: 10 }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(calls).toHaveLength(1)
  })
})
