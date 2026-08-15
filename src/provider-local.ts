/**
 * The `local` provider: the Zotero Local API at `127.0.0.1:23119/api`.
 * Capabilities are declared only for what this provider currently
 * implements, so a capability gate can never route work into a method that
 * does not exist. Search semantics follow the Local API's documented
 * behavior: server-side pagination over `/items/top`, collection and saved
 * search scopes resolved client-side (the Local API has no server-side name
 * search), and literal tag names escaped so they never become query syntax.
 * @module dsh-zotero/provider-local
 */

import { ZoteroHttpClient } from './client.js'
import {
  ZOTERO_NOT_FOUND,
  ZOTERO_SCOPE_AMBIGUOUS,
  ZoteroError,
  errorMessageOf,
} from './errors.js'
import { matchScopeName, nearScopeCandidates, normalizeScopeEntry, normalizeSearchItem } from './normalize.js'
import { formatRef, isRefString, localRef, parseRef, requireLocalRef } from './refs.js'
import type {
  ZoteroCapability,
  ZoteroObjectRef,
  ZoteroProvider,
  ZoteroResolvedScope,
  ZoteroSearchRequest,
  ZoteroSearchResult,
  ZoteroSearchScope,
  ZoteroStatus,
} from './types.js'

export const LOCAL_PROVIDER_ID = 'local'

/** Escape a literal tag so a leading `-` never becomes Zotero's NOT syntax. */
export function encodeLiteralTag(tag: string): string {
  return tag.startsWith('-') ? `\\-${tag.slice(1)}` : tag
}

/** Serialize a search request into the Local API's documented query parameters. */
export function buildSearchParams(request: ZoteroSearchRequest): URLSearchParams {
  const params = new URLSearchParams()
  if (request.query !== undefined && request.query !== '') params.set('q', request.query)
  if (request.mode === 'everything') params.set('qmode', 'everything')
  if (request.itemTypes !== undefined && request.itemTypes.length > 0) {
    params.set('itemType', request.itemTypes.join(' || '))
  }
  for (const tag of request.tags ?? []) params.append('tag', encodeLiteralTag(tag))
  params.set('sort', request.sort)
  params.set('direction', request.direction)
  params.set('start', String(request.offset))
  params.set('limit', String(request.limit))
  return params
}

interface ResolvedScopeResult {
  readonly path: string
  readonly resolved: ZoteroResolvedScope
  readonly serverId?: string
}

export class LocalApiProvider implements ZoteroProvider {
  readonly id = LOCAL_PROVIDER_ID
  readonly capabilities: ReadonlySet<ZoteroCapability> = new Set<ZoteroCapability>(['metadata', 'search', 'collections', 'tags'])

  constructor(private readonly client: ZoteroHttpClient) {}

  /**
   * Probe `GET /api/` and report connectivity plus the instance identity
   * headers. Health checks live here, not on every tool call.
   */
  async status(signal?: AbortSignal): Promise<ZoteroStatus> {
    try {
      const { headers } = await this.client.get('', undefined, { signal })
      return {
        providerId: this.id,
        connected: true,
        apiVersion: headers.get('zotero-api-version') ?? undefined,
        serverId: headers.get('zotero-server-id') ?? undefined,
        schemaVersion: headers.get('zotero-schema-version') ?? undefined,
        diagnosis: 'ok',
      }
    } catch (error) {
      return {
        providerId: this.id,
        connected: false,
        diagnosis: errorMessageOf(error),
      }
    }
  }

  async search(request: ZoteroSearchRequest, signal?: AbortSignal): Promise<ZoteroSearchResult> {
    const scope = await this.resolveScope(request.scope, signal)
    const { json, headers } = await this.client.getJson<unknown>(scope.path, buildSearchParams(request), {
      signal,
      serverId: scope.serverId,
    })
    const rows = Array.isArray(json) ? json : []
    const responseServerId = headers.get('zotero-server-id') ?? scope.serverId
    const items = rows.map((row) => normalizeSearchItem(row, responseServerId ?? undefined))
    const headerTotal = headers.get('total-results')
    const total = headerTotal !== null && headerTotal !== '' && Number.isInteger(Number(headerTotal))
      ? Number(headerTotal)
      : items.length
    const nextOffset = request.offset + items.length < total ? request.offset + items.length : undefined
    // Omit (rather than null) the pagination cursor on the final page, so the
    // result stays a pure lossless-JSON value for the tool output snapshot.
    const result: ZoteroSearchResult = { scope: scope.resolved, items, total, offset: request.offset, returned: items.length }
    if (nextOffset !== undefined) result.nextOffset = nextOffset
    return result
  }

  private async resolveScope(scope: ZoteroSearchScope, signal?: AbortSignal): Promise<ResolvedScopeResult> {
    switch (scope.kind) {
      case 'library':
        return { path: 'users/0/items/top', resolved: { kind: 'library' } }
      case 'collection': {
        const found = await this.resolveNamed('collection', scope.refOrName, signal)
        return {
          path: `users/0/collections/${found.ref.key}/items/top`,
          resolved: { kind: 'collection', ref: formatRef(found.ref), name: found.name },
          serverId: found.ref.serverId,
        }
      }
      case 'savedSearch': {
        const found = await this.resolveNamed('search', scope.refOrName, signal)
        return {
          path: `users/0/searches/${found.ref.key}/items`,
          resolved: { kind: 'savedSearch', ref: formatRef(found.ref), name: found.name },
          serverId: found.ref.serverId,
        }
      }
    }
  }

  /**
   * Resolve a collection or saved search from a ref or a name. A ref fetches
   * that single object (validating existence and reading its name); a name
   * matches client-side over the full listing, since the Local API has no
   * server-side name search for these endpoints.
   */
  private async resolveNamed(kind: 'collection' | 'search', refOrName: string, signal?: AbortSignal): Promise<{ ref: ZoteroObjectRef; name: string }> {
    const plural = kind === 'collection' ? 'collections' : 'searches'
    if (isRefString(refOrName)) {
      const ref = requireLocalRef(parseRef(refOrName), [kind])
      const { json, headers } = await this.client.getJson<unknown>(`users/0/${plural}/${ref.key}`, undefined, {
        signal,
        serverId: ref.serverId,
      })
      const entry = normalizeScopeEntry(json)
      return { ref: localRef(kind, entry.key, headers.get('zotero-server-id') ?? ref.serverId), name: entry.name }
    }
    const { json, headers } = await this.client.getJson<unknown>(`users/0/${plural}`, undefined, { signal })
    const entries = (Array.isArray(json) ? json : []).map((row) => normalizeScopeEntry(row))
    const matched = matchScopeName(entries, refOrName).matched
    if (matched.length === 1) {
      const found = matched[0]!
      return { ref: localRef(kind, found.key, headers.get('zotero-server-id') ?? undefined), name: found.name }
    }
    const label = kind === 'collection' ? 'collection' : 'saved search'
    if (matched.length > 1) {
      const list = matched.slice(0, 5).map((entry) => formatRef(localRef(kind, entry.key))).join(', ')
      throw new ZoteroError(`More than one ${label} matches "${refOrName}". Pick one of: ${list}`, ZOTERO_SCOPE_AMBIGUOUS)
    }
    const near = nearScopeCandidates(entries, refOrName, 5)
    const hint = near.length > 0 ? ` Possible matches: ${near.map((entry) => entry.name).join(', ')}` : ''
    throw new ZoteroError(`No ${label} named "${refOrName}" was found.${hint}`, ZOTERO_NOT_FOUND)
  }
}
