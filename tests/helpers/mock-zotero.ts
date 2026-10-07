/**
 * Scripted in-process HTTP server that stands in for the Zotero Local API.
 *
 * Tests drive the real `fetch` code path of the plugin against this server:
 * every request is recorded (method, pathname, query, headers) so tests can
 * assert exact wire behavior. Routes are registered per test; unmatched
 * requests get a 404 like the real server's not-found responses.
 * @module tests/helpers/mock-zotero
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One captured request, normalized for assertions. */
export interface RecordedRequest {
  readonly method: string
  readonly pathname: string
  readonly search: URLSearchParams
  readonly headers: Record<string, string | string[] | undefined>
  /** The full request body, decoded as UTF-8; empty when none was sent. */
  readonly body: string
}

/** Response-writing helpers handed to route handlers. */
interface ResponseHelpers {
  /** 200 with a JSON body. */
  json(body: unknown, headers?: Record<string, string>): void
  /** 200 with a plain-text body. */
  text(body: string, headers?: Record<string, string>): void
  /** Arbitrary status/headers/body. */
  raw(status: number, headers: Record<string, string>, body: string): void
  /** 200 JSON after `ms` milliseconds; used for timeout and cancellation tests. */
  delayJson(body: unknown, ms: number, headers?: Record<string, string>): void
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  helpers: ResponseHelpers,
  search: URLSearchParams,
) => void | Promise<void>

/** Buffer one request body to UTF-8; test bodies are small by construction. */
async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

interface Route {
  readonly method: string
  readonly matcher: string | RegExp
  readonly handler: RouteHandler
}

/**
 * Whether one registered route answers this request.
 *
 * The query string is part of the contract the plugin holds Zotero to — a
 * bare `/children` and `/children?itemType=annotation` are different reads —
 * so a matcher that carries one must see it, or a spec registering the
 * filtered route would silently be answered by the bare one:
 *
 * - a string matcher **with** a query matches only when pathname and query
 *   are equal, so the two reads stay distinguishable;
 * - a string matcher **without** one matches any query on that pathname,
 *   which is the long-standing spelling for "this path, whatever the args";
 * - a RegExp is tested against the pathname only (its patterns are anchored
 *   path shapes today; test it against `pathname + search` if a future route
 *   needs query regexes).
 */
function routeMatches(route: Route, method: string, url: URL): boolean {
  if (route.method !== method) return false
  if (typeof route.matcher !== 'string') return route.matcher.test(url.pathname)
  const queryAt = route.matcher.indexOf('?')
  if (queryAt === -1) return url.pathname === route.matcher
  return url.pathname + url.search === route.matcher
}

/**
 * The route answering one request, or undefined for a 404.
 *
 * A matcher that names a query is more specific than one that names only the
 * path, so it wins: a spec can register the bare listing and the filtered one
 * side by side — the two halves of the children contract — without depending
 * on the order it happens to call them in. Otherwise the **first** matching
 * registration wins, which is the long-standing convention across the suite
 * (and what a spec relies on when it hand-registers a handler before a
 * `route*` helper fills in defaults for the same path).
 */
function bestRoute(routes: readonly Route[], method: string, url: URL): Route | undefined {
  let bare: Route | undefined
  for (const route of routes) {
    if (!routeMatches(route, method, url)) continue
    const specific = typeof route.matcher === 'string' && route.matcher.includes('?')
    if (specific) return route
    bare ??= route
  }
  return bare
}

export class MockZotero {
  readonly requests: RecordedRequest[] = []
  /** `http://127.0.0.1:<port>/api` — the base URL to configure the plugin with. */
  baseUrl = ''
  private server: Server | undefined
  private readonly routes: Route[] = []

  static async start(): Promise<MockZotero> {
    const mock = new MockZotero()
    const server = createServer((req, res) => {
      void mock.handle(req, res).catch((error: unknown) => {
        res.destroy(error instanceof Error ? error : undefined)
      })
    })
    mock.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address() as AddressInfo
    mock.baseUrl = `http://127.0.0.1:${address.port}/api`
    return mock
  }

  route(method: string, matcher: string | RegExp, handler: RouteHandler): this {
    this.routes.push({ method, matcher, handler })
    return this
  }

  async close(): Promise<void> {
    const server = this.server
    if (server === undefined) return
    // `server.close()` only closes the connections idle at the moment it is
    // called; handlers still in flight would keep the callback waiting for
    // the client's keep-alive timeout, so destroy every connection outright.
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    this.requests.push({
      method: req.method ?? 'GET',
      pathname: url.pathname,
      search: url.searchParams,
      headers: req.headers,
      body: await readRequestBody(req),
    })
    const helpers: ResponseHelpers = {
      json: (body, headers) => {
        res.writeHead(200, { 'Content-Type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      },
      text: (body, headers) => {
        res.writeHead(200, { 'Content-Type': 'text/plain', ...headers })
        res.end(body)
      },
      raw: (status, headers, body) => {
        res.writeHead(status, headers)
        res.end(body)
      },
      delayJson: (body, ms, headers) => {
        setTimeout(() => {
          if (res.writableEnded || res.destroyed) return
          helpers.json(body, headers)
        }, ms).unref()
      },
    }
    const route = bestRoute(this.routes, req.method ?? 'GET', url)
    if (route === undefined) {
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
      return
    }
    await route.handler(req, res, helpers, url.searchParams)
  }
}
