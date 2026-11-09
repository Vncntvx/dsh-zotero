/**
 * The MinerU transport: the public-address gate, per-hop redirect
 * re-validation, method/body delivery, and — the security-critical part —
 * Authorization sent only to the fixed API host, never to a signed upload URL
 * or result CDN.
 * @module tests/host/parsing-transport
 */

import { describe, expect, it, vi } from 'vitest'
import { MineruClient, MineruHttpError } from '../../src/parsing/transport.ts'
import { ResponseTooLargeError } from '../../src/transport-bounds.ts'
import { PublicAddressError } from '../../src/transport/public-url.ts'

type FetchCall = { url: string; init: RequestInit }

function clientOf(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  resolver: (hostname: string) => Promise<{ address: string; family: 4 | 6 }[]> = async () => [
    { address: '93.184.216.34', family: 4 },
  ],
) {
  const calls: FetchCall[] = []
  const client = new MineruClient({
    resolver: async (hostname) => await resolver(hostname),
    dispatcher: () => ({ dispatcher: {} as never, close: async () => {} }),
    fetch: async (url, init) => {
      calls.push({ url, init: init ?? {} })
      return await fetchImpl(url, init)
    },
  })
  return { client, calls }
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>
}

describe('MineruClient request', () => {
  it('sends the configured method and body', async () => {
    const { client, calls } = clientOf(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    await client.json('https://mineru.net/api/v1/agent/parse/file', {
      method: 'POST',
      body: JSON.stringify({ file_name: 'document.pdf' }),
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.body).toBe('{"file_name":"document.pdf"}')
  })

  it('attaches Authorization to the MinerU API host in pro mode', async () => {
    const { client, calls } = clientOf(async () => new Response('{}', { status: 200 }))
    await client.json('https://mineru.net/api/v4/extract-results/batch/b1', {
      method: 'GET',
      token: 'secret-token',
    })
    expect(headersOf(calls[0]!.init).authorization).toBe('Bearer secret-token')
  })

  it('never attaches Authorization to a signed upload host', async () => {
    const { client, calls } = clientOf(async () => new Response('', { status: 200 }))
    await client.bytes('https://oss-mineru.openxlab.org.cn/agent/x.pdf?Expires=1', {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
      token: 'secret-token',
    })
    expect(headersOf(calls[0]!.init).authorization).toBeUndefined()
  })

  it('never attaches Authorization to a result CDN host', async () => {
    const { client, calls } = clientOf(async () => new Response('# md', { status: 200 }))
    await client.bytes('https://cdn-mineru.openxlab.org.cn/pdf/x/full.md', {
      method: 'GET',
      token: 'secret-token',
    })
    expect(headersOf(calls[0]!.init).authorization).toBeUndefined()
  })

  it('refuses a non-public literal host before fetching', async () => {
    const { client } = clientOf(async () => new Response('', { status: 200 }))
    await expect(
      client.json('http://127.0.0.1:23119/api', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PublicAddressError)
  })

  it('refuses a private DNS answer', async () => {
    const { client } = clientOf(
      async () => new Response('', { status: 200 }),
      async () => [{ address: '10.0.0.5', family: 4 }],
    )
    await expect(
      client.json('https://mineru.net/api/v1/agent/parse/file', { method: 'POST' }),
    ).rejects.toBeInstanceOf(PublicAddressError)
  })

  it('follows a redirect and revalidates the next hop', async () => {
    let hop = 0
    const { client, calls } = clientOf(async () => {
      hop += 1
      if (hop === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn-mineru.openxlab.org.cn/r.md' },
        })
      }
      return new Response('# done', { status: 200 })
    })
    const bytes = await client.bytes('https://mineru.net/api/v1/agent/parse/t1', {
      method: 'GET',
      token: 'secret-token',
    })
    expect(new TextDecoder().decode(bytes)).toBe('# done')
    expect(calls).toHaveLength(2)
    // The token rode the first hop only; the CDN hop must not receive it.
    expect(headersOf(calls[0]!.init).authorization).toBe('Bearer secret-token')
    expect(headersOf(calls[1]!.init).authorization).toBeUndefined()
  })

  it('refuses an HTTPS redirect that downgrades to HTTP', async () => {
    const { client } = clientOf(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://cdn.example.com/r' } }),
    )
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/t1', { method: 'GET' }),
    ).rejects.toBeInstanceOf(PublicAddressError)
  })

  it('raises a host-only error on a non-2xx response', async () => {
    const { client } = clientOf(async () => new Response('nope', { status: 500 }))
    await expect(
      client.json('https://mineru.net/api/v1/agent/parse/file', { method: 'POST' }),
    ).rejects.toMatchObject({ name: 'MineruHttpError', status: 500, host: 'mineru.net' })
    expect(new MineruHttpError(500, 'mineru.net').message).toBe('HTTP 500 from mineru.net')
  })

  it('keeps a sanitized error detail without leaking the signed URL', async () => {
    const { client } = clientOf(
      async () =>
        new Response(
          JSON.stringify({
            code: -1,
            msg: 'SignatureDoesNotMatch at https://oss.example/u?Signature=secret',
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    )
    const error = await client
      .bytes('https://mineru.net/api/v1/agent/parse/file', { method: 'PUT' })
      .catch((caught: unknown) => caught)
    expect(error).toMatchObject({ name: 'MineruHttpError', status: 403 })
    expect((error as Error).message).toContain('SignatureDoesNotMatch')
    expect((error as Error).message).not.toContain('https://oss.example')
    expect((error as Error).message).not.toContain('secret')
  })

  it('HEAD returns response headers and never attaches the token to a CDN', async () => {
    const { client, calls } = clientOf(
      async () =>
        new Response(null, { status: 200, headers: { etag: '"v1"', 'content-length': '42' } }),
    )
    const { status, headers } = await client.head('https://cdn.example/r.pdf', {
      method: 'HEAD',
      token: 'secret-token',
    })
    expect(status).toBe(200)
    expect(headers.get('etag')).toBe('"v1"')
    expect(calls[0]!.init.method).toBe('HEAD')
    expect(headersOf(calls[0]!.init).authorization).toBeUndefined()
  })

  it('refuses a response body over the byte ceiling', async () => {
    const { client } = clientOf(async () => new Response(new Uint8Array(64), { status: 200 }))
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/t1', { method: 'GET', maxBytes: 8 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('rejects malformed JSON with a stated reason', async () => {
    const { client } = clientOf(async () => new Response('not json', { status: 200 }))
    await expect(
      client.json('https://mineru.net/api/v1/agent/parse/file', { method: 'POST' }),
    ).rejects.toThrow('MinerU returned a malformed JSON response.')
  })

  it('propagates caller cancellation', async () => {
    const controller = new AbortController()
    const { client } = clientOf(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted === true) {
            reject(signal.reason)
            return
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
          controller.abort(new Error('cancelled'))
        }),
    )
    const pending = client.bytes('https://mineru.net/api/v1/agent/parse/t1', {
      method: 'GET',
      signal: controller.signal,
    })
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('closes the pinned connection on every attempt', async () => {
    const close = vi.fn(async () => {})
    const client = new MineruClient({
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      dispatcher: () => ({ dispatcher: {} as never, close }),
      fetch: async () => new Response('{}', { status: 200 }),
    })
    await client.json('https://mineru.net/api/v1/agent/parse/file', { method: 'POST' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('refuses a malformed URL before fetching', async () => {
    const { client } = clientOf(async () => new Response('', { status: 200 }))
    await expect(client.bytes('not a url', { method: 'GET' })).rejects.toBeInstanceOf(
      PublicAddressError,
    )
  })

  it('raises on a redirect without a location', async () => {
    const { client } = clientOf(async () => new Response(null, { status: 302 }))
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/t1', { method: 'GET' }),
    ).rejects.toMatchObject({ name: 'MineruHttpError', status: 302 })
  })

  it('raises after the redirect ceiling', async () => {
    const { client } = clientOf(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://mineru.net/api/v1/agent/parse/t1' },
        }),
    )
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/t1', { method: 'GET' }),
    ).rejects.toMatchObject({ name: 'MineruHttpError', status: 302 })
  })

  it('refuses a declared body over the byte ceiling before reading it', async () => {
    const { client } = clientOf(
      async () => new Response('xx', { status: 200, headers: { 'content-length': '999' } }),
    )
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/t1', { method: 'GET', maxBytes: 8 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError)
  })

  it('get returns the response headers', async () => {
    const { client } = clientOf(
      async () => new Response('body', { status: 200, headers: { etag: '"v1"' } }),
    )
    const result = await client.get('https://cdn.example/r.pdf', { method: 'GET' })
    expect(new TextDecoder().decode(result.bytes)).toBe('body')
    expect(result.headers.get('etag')).toBe('"v1"')
  })

  it('uses a code-only JSON error detail', async () => {
    const { client } = clientOf(
      async () =>
        new Response(JSON.stringify({ code: 'SignatureDoesNotMatch' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/file', { method: 'PUT' }),
    ).rejects.toThrow(/SignatureDoesNotMatch/)
  })

  it('drops an error body over the detail ceiling', async () => {
    const { client } = clientOf(async () => new Response('x'.repeat(5_000), { status: 500 }))
    await expect(
      client.bytes('https://mineru.net/api/v1/agent/parse/file', { method: 'POST' }),
    ).rejects.toThrow('HTTP 500 from mineru.net')
  })
})
