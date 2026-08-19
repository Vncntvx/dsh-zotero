/**
 * Zotero object reference grammar.
 *
 * Model-facing refs are plain JSON strings of the form
 * `zotero://<libraryType>/<id>/<kind>/<key>` (e.g.
 * `zotero://user/0/item/ABCD1234`) with an optional provenance qualifier
 * `?server=<Zotero-Server-ID>` recorded by Zotero 10+. Zotero object keys are
 * 8 uppercase alphanumeric characters. The library segment makes identity
 * explicit: an object key is never treated as a global identity. Group
 * libraries and non-zero user ids parse here, but the V1 local provider
 * fails closed on them, so the grammar does not have to change when they
 * gain support.
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

/** Build a ref for the V1 local library (user/0) without string round-tripping. */
export function localRef(kind: ZoteroKind, key: string, serverId?: string): ZoteroObjectRef {
  if (!isObjectKey(key)) {
    throw new ZoteroError(`Invalid Zotero key "${key}".`, ZOTERO_INVALID_REF)
  }
  return { library: { type: 'user', id: 0 }, kind, key, serverId }
}

/**
 * Assert that a ref names the V1-supported library: the locally logged-in
 * user expressed as `user/0`. Group libraries and foreign user ids fail
 * closed with a typed error instead of silently serving wrong data.
 */
function assertLocalRef(ref: ZoteroObjectRef): ZoteroObjectRef {
  if (ref.library.type === 'group') {
    throw new ZoteroError(
      `Group library references are not supported by this plugin version (got zotero://${ref.library.type}/${ref.library.id}/${ref.kind}/${ref.key}).`,
      ZOTERO_INVALID_REF,
    )
  }
  if (ref.library.id !== 0) {
    throw new ZoteroError(
      `Use zotero://user/0/${ref.kind}/${ref.key}: the local API serves only the logged-in user's library.`,
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

/** Shared guard for provider use: local library only, plus an optional kind filter. */
export function requireLocalRef(
  ref: ZoteroObjectRef,
  kinds?: readonly ZoteroKind[],
): ZoteroObjectRef {
  assertLocalRef(ref)
  if (kinds !== undefined) assertKind(ref, kinds)
  return ref
}
