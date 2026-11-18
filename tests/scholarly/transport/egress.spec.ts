/**
 * The egress route: how the harness proxy policy decides one request's
 * transport, and what the scholarly arms do with the answer.
 *
 * Direct (no proxy in the environment) keeps the closed-set path: the lexical
 * gate runs, addresses are resolved and pinned. Proxied, the route's
 * process-wide dispatcher carries the request — the proxy performs the DNS, so
 * no address pinning applies, but the lexical gate still runs first, and the
 * route dispatcher is never closed by the caller.
 * @module tests/scholarly/transport/egress
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { installProxyFromEnvironment, proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { egressRouteFor } from '../../../src/transport/connections.js'
import { createScholarlyHttp } from '../../../src/scholarly/transport/http.js'
import { resolverOf, stubPublicAccessWith } from '../../helpers/scholarly-runtime.js'

const HOST = 'api.openalex.org'
const WORKS_URL = `https://${HOST}/works`

const disposers: Array<() => Promise<void>> = []
const servers: Server[] = []
const envSnapshots: Array<Record<string, string | undefined>> = []

afterEach(async () => {
  try {
    for (const dispose of disposers.splice(0).reverse()) await dispose()
  } finally {
    try {
      for (const server of servers.splice(0).reverse()) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      }
    } finally {
      vi.unstubAllEnvs()
      for (const snapshot of envSnapshots.splice(0).reverse()) {
        for (const [name, value] of Object.entries(snapshot)) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      }
    }
  }
})

function snapshotProxyEnv(): Record<string, string | undefined> {
  const names = [
    'http_proxy',
    'HTTP_PROXY',
    'https_proxy',
    'HTTPS_PROXY',
    'no_proxy',
    'NO_PROXY',
    'all_proxy',
    'ALL_PROXY',
    'NODE_USE_ENV_PROXY',
  ]
  const snapshot: Record<string, string | undefined> = {}
  for (const name of names) snapshot[name] = process.env[name]
  envSnapshots.push(snapshot)
  return snapshot
}

/** A direct route when the environment names no proxy. */
describe('the egress route without a proxy environment', () => {
  it('answers direct for a plain URL and installs nothing', () => {
    const route = egressRouteFor(new URL(WORKS_URL))
    expect(route).toEqual({ proxied: false })
    expect(proxyRouteFor(new URL(WORKS_URL)).proxied).toBe(false)
  })
})

describe('the egress route with an installed proxy policy', () => {
  it('answers proxied with the policy dispatcher and never closes it', async () => {
    snapshotProxyEnv()
    // A loopback proxy URL: real enough for undici's policy parser, and the
    // route decision itself never opens a socket.
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9/'
    const dispose = await installProxyFromEnvironment(
      {
        get: (name) => (process.env[name] === undefined ? undefined : { value: process.env[name] }),
      },
      () => undefined,
    )
    disposers.push(dispose)
    const route = egressRouteFor(new URL(WORKS_URL))
    expect(route.proxied).toBe(true)
    if (!route.proxied) return
    // A closed shared dispatcher would break every later request, so the
    // route hands out the live one. The dispatcher is owned by the installed
    // policy, whose disposer below is the only closer.
    expect(route.dispatcher).toBeDefined()
  })

  it('keeps the lexical gate ahead of a proxied request', async () => {
    snapshotProxyEnv()
    process.env.HTTPS_PROXY = 'http://127.0.0.1:9/'
    const dispose = await installProxyFromEnvironment(
      {
        get: (name) => (process.env[name] === undefined ? undefined : { value: process.env[name] }),
      },
      () => undefined,
    )
    disposers.push(dispose)
    const fetchImpl = vi.fn(async () => {
      throw new Error('a non-public address must never reach fetch')
    })
    const http = createScholarlyHttp({
      fetchImpl: fetchImpl as unknown as (url: string, init?: RequestInit) => Promise<Response>,
      publicAccess: stubPublicAccessWith(resolverOf([{ address: '93.184.216.34', family: 4 }])),
    })
    // A private address is refused by the lexical gate even though a proxy
    // would be the one performing the DNS.
    await expect(http.text('http://127.0.0.1:9/works')).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('carries a proxied HTTPS request to the proxy as a CONNECT', async () => {
    snapshotProxyEnv()
    const seen: string[] = []
    // A plain-HTTP server as the "proxy": an HTTPS target arrives as a
    // CONNECT event with the authority. The server does not tunnel, so the
    // attempt fails after the proxy saw the request — which is exactly the
    // proof this test needs: the route dispatcher (same undici copy as
    // publicFetch) routed the request to the proxy.
    const server = createServer()
    server.on('connect', (request, socket) => {
      seen.push(`CONNECT ${request.url}`)
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no server address')

    process.env.HTTPS_PROXY = `http://127.0.0.1:${address.port}`
    const dispose = await installProxyFromEnvironment(
      {
        get: (name) => (process.env[name] === undefined ? undefined : { value: process.env[name] }),
      },
      () => undefined,
    )
    disposers.push(dispose)

    const { publicFetch } = await import('../../../src/transport/connections.js')
    const http = createScholarlyHttp({
      fetchImpl: publicFetch as unknown as (url: string, init?: RequestInit) => Promise<Response>,
      publicAccess: stubPublicAccessWith(resolverOf([{ address: '93.184.216.34', family: 4 }])),
    })
    await expect(http.text(WORKS_URL)).rejects.toThrow()
    // The transport retries the transport failure, so every attempt reaches
    // the proxy; what matters is that each one arrives as CONNECT to the
    // reviewed authority instead of a pinned direct socket.
    expect(seen.length).toBeGreaterThan(0)
    for (const entry of seen) expect(entry).toBe(`CONNECT ${HOST}:443`)
  })
})
