/**
 * The route harness the `changes()` spec reads: a cursor fixture, a key→version
 * map fixture, synthetic key batches, the three-way item-space routes
 * (`/items`, `/items/top`, `/items/trash`) with the pre-read version probe on
 * `/items/top`, the non-items versions resources, `/deleted`, and the request
 * filter that separates the probe from the diffs.
 *
 * The handlers assert the read shapes the domain must use — `since` present,
 * `format` `versions`, and no `limit` on a diff, while the probe carries
 * `limit=1`. Those assertions are the contract: a versioned read that quietly
 * paginates fails here rather than pinning a version past the rows it hid.
 * @module tests/provider/changes-server
 */

import { expect } from 'vitest'
import { DEFAULT_CHANGES_INCLUDES } from '../../src/local/changes-domain.js'
import type { ZoteroChangesCursor, ZoteroChangesInclude } from '../../src/types.js'
import type { MockZotero, RouteHandler } from '../helpers/mock-zotero.js'
import { PERSONAL_LIBRARY, SERVER_ID, apiPath } from '../helpers/server/keys.js'
import { versionHeaders } from '../helpers/server/objects.js'

/** The cursor the fixtures start from: instance S1, personal library, version 42. */
export function at(
  version: number,
  serverId = SERVER_ID,
  include: readonly ZoteroChangesInclude[] = DEFAULT_CHANGES_INCLUDES,
): ZoteroChangesCursor {
  return { serverId, library: PERSONAL_LIBRARY, version, include: [...include] }
}

/** A key→version map shaped like `format=versions` responses. */
export function versionMap(entries: [string, number][]): Record<string, number> {
  return Object.fromEntries(entries)
}

/** `count` synthetic 8-character keys at ascending versions. */
export function changedKeys(count: number): [string, number][] {
  return Array.from({ length: count }, (_, index) => [
    `KEY${String(index + 1).padStart(5, '0')}`,
    index + 1,
  ])
}

type Endpoint = 'live' | 'top' | 'trash'

/** How one endpoint's diff answer behaves; the probe on `/items/top` is separate. */
type DiffBehaviour = 'ok' | 'not-found' | 'error'

export interface ItemsFixture {
  /** Changed top-level items (`/items/top`). */
  readonly top?: Record<string, number>
  /**
   * Changed child objects — notes, attachments, annotations. Only `/items`
   * reports them, which is exactly the difference the diff splits on.
   */
  readonly children?: Record<string, number>
  /** Changed items in the trash (`/items/trash`). */
  readonly trash?: Record<string, number>
  readonly prefix?: string
  /** The version the probe and (by default) the diff reads report. */
  readonly version?: string
  /** The version the diff reads alone report, for a snapshot that moved. */
  readonly diffVersion?: string
  /** `Total-Results` overrides; defaults to each body's key count. */
  readonly total?: Partial<Record<Endpoint, string>>
  /** Probe shape: versioned 200 (default), 200 without the header, or 404. */
  readonly probe?: 'ok' | 'unversioned' | 'not-found'
  /** One partition whose diff response omits its library-version header. */
  readonly unversionedDiff?: Endpoint
  /** Per-endpoint diff answers; defaults to a 200 map for all three. */
  readonly diff?: Partial<Record<Endpoint, DiffBehaviour>>
  /** Raw bodies that replace a computed map, for the shape tests. */
  readonly body?: Partial<Record<Endpoint, unknown>>
  /** The instance the responses claim, for a build that ignores the request header. */
  readonly serverId?: string
}

/**
 * Serve the item space the way the API partitions it: `/items` (live items,
 * child objects included), `/items/top` (their top-level subset) and
 * `/items/trash`. `/items/top` also carries the pre-read version probe
 * (`?limit=1`, headers only), so the cursor claim depends on the two reporting
 * one version.
 * @param mock - the server to register the three routes on.
 * @param options - the versions each read reports and how the diff answers.
 */
export function routeItems(mock: MockZotero, options: ItemsFixture = {}): void {
  const prefix = options.prefix ?? apiPath()
  const version = options.version ?? '50'
  const serverId = options.serverId ?? SERVER_ID
  const top = options.top ?? {}
  const bodies: Record<Endpoint, Record<string, number>> = {
    live: { ...top, ...(options.children ?? {}) },
    top,
    trash: options.trash ?? {},
  }
  const answer = (
    endpoint: Endpoint,
    helpers: Parameters<RouteHandler>[2],
    search: URLSearchParams,
  ): void => {
    if (endpoint === 'top' && search.get('limit') === '1') {
      if (options.probe === 'not-found') {
        helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
        return
      }
      helpers.json(
        [],
        options.probe === 'unversioned'
          ? versionHeaders(serverId)
          : versionHeaders(serverId, Number(version)),
      )
      return
    }
    expect(search.get('since')).toBeDefined()
    expect(search.get('format')).toBe('versions')
    // The diff is read unbounded: a page cap would report a version that
    // already sits past the rows it hid, which is the bug this pins.
    expect(search.get('limit')).toBeNull()
    const behaviour = options.diff?.[endpoint] ?? 'ok'
    if (behaviour === 'not-found') {
      helpers.raw(404, { 'Content-Type': 'text/plain' }, 'Not found')
      return
    }
    if (behaviour === 'error') {
      helpers.raw(500, { 'Content-Type': 'text/plain' }, 'boom')
      return
    }
    const body = options.body?.[endpoint] ?? bodies[endpoint]
    const total =
      options.total?.[endpoint] ??
      String(Array.isArray(body) ? body.length : Object.keys(body ?? {}).length)
    helpers.json(body, {
      ...(options.unversionedDiff === endpoint
        ? versionHeaders(serverId)
        : versionHeaders(serverId, Number(options.diffVersion ?? version))),
      'Total-Results': total,
    })
  }
  mock.route('GET', `${prefix}/items`, (req, res, helpers, search) =>
    answer('live', helpers, search),
  )
  mock.route('GET', `${prefix}/items/top`, (req, res, helpers, search) =>
    answer('top', helpers, search),
  )
  mock.route('GET', `${prefix}/items/trash`, (req, res, helpers, search) =>
    answer('trash', helpers, search),
  )
}

/**
 * Serve one non-items versions resource; `headers` carries what the build
 * sends.
 * @param mock - the server to register the route on.
 * @param path - the resource pathname.
 * @param body - the key→version map to answer with.
 * @param headers - extra response headers, over the instance header.
 */
export function routeVersions(
  mock: MockZotero,
  path: string,
  body: Record<string, number>,
  headers: Record<string, string> = {},
): void {
  mock.route('GET', path, (req, res, helpers, search) => {
    expect(search.get('since')).toBeDefined()
    expect(search.get('format')).toBe('versions')
    expect(search.get('limit')).toBeNull()
    helpers.json(body, { ...versionHeaders(), ...headers })
  })
}

/** A tombstone payload with all four documented lists. */
export function tombstones(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { items: [], collections: [], searches: [], tags: [], ...overrides }
}

/**
 * Serve `/deleted` with a well-formed payload.
 * @param mock - the server to register the route on.
 * @param overrides - the tombstone lists to replace; the rest stay empty.
 */
export function routeTombstones(mock: MockZotero, overrides: Record<string, unknown> = {}): void {
  mock.route('GET', `${apiPath()}/deleted`, (req, res, helpers, search) => {
    expect(search.get('since')).toBeDefined()
    helpers.json(tombstones(overrides))
  })
}

/** The diff requests only: the probe is an `/items/top?limit=1` read. */
export function diffRequests(mock: MockZotero): { pathname: string }[] {
  return mock.requests.filter((request) => request.search.get('limit') !== '1')
}
