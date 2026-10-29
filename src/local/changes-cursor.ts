/**
 * @module dsh-zotero/local/changes-cursor
 */

import { ALL_CHANGES_INCLUDES } from '../changes-contract.js'
import { isNonNegativeSafeInteger, parseNonNegativeSafeInteger } from '../json.js'
import type { SupportedLocalLibrary, ZoteroChangesCursor, ZoteroChangesInclude } from '../types.js'

export function numericHeader(headers: Headers, name: string): number | undefined {
  return parseNonNegativeSafeInteger(headers.get(name))
}

export function isVersion(value: unknown): value is number {
  return isNonNegativeSafeInteger(value)
}

function orderedIncludes(include: ReadonlySet<ZoteroChangesInclude>): ZoteroChangesInclude[] {
  return ALL_CHANGES_INCLUDES.filter((kind) => include.has(kind))
}

/** `user/0` or `group/42`, the way the model names a library. */
export function libraryLabelOf(library: SupportedLocalLibrary): string {
  return `${library.type}/${String(library.id)}`
}

/**
 * The model-facing message for a cursor minted in one library and passed to a
 * diff of another. A version counter is a per-library transaction count, so
 * the two numbers are unrelated and no response would reveal the mix-up.
 */
export function cursorLibraryMismatchMessage(
  cursorLibrary: string,
  requestLibrary: string,
): string {
  return `This cursor belongs to ${cursorLibrary}, but the call diffs ${requestLibrary}. A library version is only meaningful in the library it came from; diff that library, or take a baseline reading here.`
}

/** A response identity is usable only when it is a non-blank string. */
export function observedServerId(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && value.trim() !== '' ? value : undefined
}

/**
 * The cursor for `version`, or undefined when there is no instance to pin it
 * to, or when every requested kind ended up unserved and there is nothing to
 * checkpoint. The cursor certifies only the kinds it actually tracked: kinds
 * the build structurally does not serve ride `unserved`, never `include`, so
 * the coverage claim stays true and a later call can still resume them — the
 * answer will be the same absence.
 */
export function cursorFor(
  serverId: string | undefined,
  library: SupportedLocalLibrary,
  version: number | undefined,
  include: ReadonlySet<ZoteroChangesInclude>,
  unserved: ReadonlySet<ZoteroChangesInclude>,
): ZoteroChangesCursor | undefined {
  const id = observedServerId(serverId)
  if (id === undefined || version === undefined) return undefined
  const tracked = [...include].filter((kind) => !unserved.has(kind))
  if (tracked.length === 0) return undefined
  return {
    serverId: id,
    library,
    version,
    include: orderedIncludes(new Set(tracked)),
    unserved: orderedIncludes(unserved),
  }
}
