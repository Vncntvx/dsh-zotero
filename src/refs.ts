/**
 * Zotero object reference grammar.
 *
 * Model-facing refs are plain JSON strings of the form
 * `zotero://<libraryType>/<id>/<kind>/<key>` (e.g.
 * `zotero://user/0/item/ABCD1234`) with an optional provenance qualifier
 * `?server=<Zotero-Server-ID>` recorded by Zotero 10+. Zotero object keys are
 * 8 uppercase alphanumeric characters. The library segment makes identity
 * explicit: an object key is never treated as a global identity. Group
 * libraries parse here and are served by the local provider; foreign user
 * ids still fail closed (`requireSupportedLocalRef`).
 * @module dsh-zotero/refs
 */

import { ZOTERO_INVALID_REF, ZoteroError } from './errors.js'
import { isObjectKey } from './json.js'
import type { ZoteroKind, ZoteroObjectRef } from './types.js'

const REF_PATTERN =
  /^zotero:\/\/(user|group)\/(\d+)\/(item|attachment|annotation|collection|search)\/([A-Z0-9]{8})(?:\?server=([A-Za-z0-9_-]{1,64}))?$/

/** True when the given string matches the ref grammar without fully parsing it. */
export function isRefString(value: string): boolean {
  return REF_PATTERN.test(value)
}

/**
 * Parse a model-provided ref string into a {@link ZoteroObjectRef}.
 * @param value - the exact string a tool argument or result carried.
 * @returns the parsed ref.
 * @throws {ZoteroError} `ZOTERO_INVALID_REF` for anything outside the grammar.
 */
export function parseRef(value: string): ZoteroObjectRef {
  const match = REF_PATTERN.exec(value)
  if (match === null) {
    throw new ZoteroError(
      `Invalid Zotero reference "${value}". Expected zotero://user/0/<item|attachment|annotation|collection|search>/<KEY> with an 8-character key, optionally followed by ?server=<id>.`,
      ZOTERO_INVALID_REF,
    )
  }
  const [, libraryType, id, kind, key, serverId] = match
  return {
    library: { type: libraryType as 'user' | 'group', id: Number(id) },
    kind: kind as ZoteroKind,
    key,
    serverId,
  }
}

/** Format a parsed ref back to its canonical string form. */
export function formatRef(ref: ZoteroObjectRef): string {
  const base = `zotero://${ref.library.type}/${ref.library.id}/${ref.kind}/${ref.key}`
  return ref.serverId === undefined ? base : `${base}?server=${ref.serverId}`
}

/** True when a library is one the local contract may address: personal canonical 0 or any group. */
export function isSupportedLocalLibrary(library: { type: string; id: number }): boolean {
  if (library.type === 'user') return library.id === 0
  if (library.type === 'group') return Number.isInteger(library.id) && library.id > 0
  return false
}

/** Build a URL prefix for a supported local library: users/0 or groups/{id}. */
export function libraryPrefix(library: { type: 'user' | 'group'; id: number }): string {
  if (library.type === 'user') return 'users/0'
  return `groups/${library.id}`
}

/** True when both values name the same library (type and id). */
export function sameLibrary(
  a: { type: 'user' | 'group'; id: number },
  b: { type: 'user' | 'group'; id: number },
): boolean {
  return a.type === b.type && a.id === b.id
}

/** The personal library canonical constant for discovery endpoints. */
export const PERSONAL_LIBRARY: { readonly type: 'user'; readonly id: 0 } = { type: 'user', id: 0 }

/** Intentional personal-only discovery prefix (only GET /users/0/groups uses it). */
export const PERSONAL_GROUPS_DISCOVERY = 'users/0/groups'

/** Build a ref for any supported local library. */
export function refForLibrary(
  library: { type: 'user' | 'group'; id: number },
  kind: ZoteroKind,
  key: string,
  serverId?: string,
): ZoteroObjectRef {
  if (!isObjectKey(key)) {
    throw new ZoteroError(`Invalid Zotero key "${key}".`, ZOTERO_INVALID_REF)
  }
  if (!isSupportedLocalLibrary(library)) {
    throw new ZoteroError(
      `Unsupported library zotero://${library.type}/${library.id}: only user/0 and groups are supported.`,
      ZOTERO_INVALID_REF,
    )
  }
  return { library: { type: library.type, id: library.id }, kind, key, serverId }
}

/**
 * Assert that a ref names a supported local library: user/0 or any group.
 * This is the provider-level contract (non-zero user ids fail closed).
 */
function assertSupportedLocalRef(ref: ZoteroObjectRef): ZoteroObjectRef {
  if (!isSupportedLocalLibrary(ref.library)) {
    if (ref.library.type === 'user' && ref.library.id !== 0) {
      throw new ZoteroError(
        `Use zotero://user/0/${ref.kind}/${ref.key}: the local API serves only the logged-in user's library (group libraries use zotero://group/<id>/...).`,
        ZOTERO_INVALID_REF,
      )
    }
    throw new ZoteroError(
      `Unsupported library zotero://${ref.library.type}/${ref.library.id}: only user/0 and groups are supported.`,
      ZOTERO_INVALID_REF,
    )
  }
  return ref
}

/** Assert the ref kind is one of the allowed kinds. @param kinds - allowed kinds. */
function assertKind(ref: ZoteroObjectRef, kinds: readonly ZoteroKind[]): ZoteroObjectRef {
  if (!kinds.includes(ref.kind)) {
    throw new ZoteroError(
      `Expected a ${kinds.join(' or ')} reference, got ${ref.kind}.`,
      ZOTERO_INVALID_REF,
    )
  }
  return ref
}

/** Shared guard for provider use: supported local library, plus an optional kind filter. */
export function requireSupportedLocalRef(
  ref: ZoteroObjectRef,
  kinds?: readonly ZoteroKind[],
): ZoteroObjectRef {
  assertSupportedLocalRef(ref)
  if (kinds !== undefined) assertKind(ref, kinds)
  return ref
}

/**
 * Parse a Zotero canonical relation URI (http://zotero.org/users|groups/.../items/KEY)
 * into a library+key pair. Returns null for non-Zotero, malformed, or non-item URIs.
 * This never canonicalizes foreign user ids to user/0 — caller decides if mapping is provable.
 */
export function parseZoteroRelationUri(
  uri: string,
): { library: { type: 'user' | 'group'; id: number }; key: string } | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host !== 'zotero.org' && host !== 'www.zotero.org' && host !== 'api.zotero.org') return null
  const m = /^\/users\/(\d+)\/items\/([A-Z0-9]{8})(?:[/?#].*)?$/.exec(url.pathname)
  if (m) return { library: { type: 'user', id: Number(m[1]!) }, key: m[2]! }
  const mg = /^\/groups\/(\d+)\/items\/([A-Z0-9]{8})(?:[/?#].*)?$/.exec(url.pathname)
  if (mg) return { library: { type: 'group', id: Number(mg[1]!) }, key: mg[2]! }
  return null
}
