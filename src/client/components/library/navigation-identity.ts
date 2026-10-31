/**
 * The panel's object identity: one string that names the served instance, the
 * library, the kind, and the key of a ref. Two rows are the same object only
 * when every field agrees, so the same key in two libraries — or in two
 * Zotero instances — never collapses into one selection.
 * @module dsh-zotero/client/components/library/navigation-identity
 */

import { refFieldsOf } from '../../../ref-grammar.ts'
import type { SupportedLocalLibrary } from '../../../contract.ts'
import type { LibrarySelection } from './library-model.ts'

/**
 * The identity of one ref. An unqualified ref inherits the confirmed instance,
 * because storage keeps the refs a previous session wrote while the rows the
 * server serves carry the qualifier.
 * @param ref - the ref to identify; a non-ref string is its own identity.
 * @param serverId - the instance to assume when the ref does not name one.
 * @returns a stable string for comparisons and lane keys.
 */
export function objectIdentity(ref: string, serverId?: string): string {
  const fields = refFieldsOf(ref)
  if (fields === undefined) return ref
  return JSON.stringify([
    fields.serverId ?? serverId,
    fields.libraryType,
    fields.libraryId,
    fields.kind,
    fields.key,
  ])
}

/** The identity of one scope: its ref identity, or its fixed-scope kind. */
export function scopeIdentity(scope: LibrarySelection, serverId?: string): string {
  return 'ref' in scope ? objectIdentity(scope.ref, serverId) : scope.kind
}

/**
 * The key one instance's reading scope answers to: the instance, the library,
 * and the scope identity. A component keyed on it starts fresh whenever any of
 * those moves, and the instance id keeps two Zotero servers that serve the
 * same library and ref apart.
 * @param library - the library the panel is reading.
 * @param scope - the selected fixed scope or ref.
 * @param serverId - the confirmed instance, if the probe has answered.
 * @returns a stable string for React keys and stale-write guards.
 */
export function scopeKeyOf(
  library: SupportedLocalLibrary,
  scope: LibrarySelection,
  serverId?: string,
): string {
  return JSON.stringify([serverId, library, scopeIdentity(scope, serverId)])
}
