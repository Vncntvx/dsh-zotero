import { REF_PATTERN } from '../../../ref-grammar.ts'
import type { LibrarySelection } from './library-model.ts'

/** Qualify unclaimed refs only after the feed has confirmed its instance. */
export function objectIdentity(ref: string, serverId?: string): string {
  const fields = REF_PATTERN.exec(ref)?.groups
  if (!fields) return ref
  return JSON.stringify([
    fields.serverId ?? serverId,
    fields.libraryType,
    fields.libraryId,
    fields.kind,
    fields.key,
  ])
}
export function scopeIdentity(scope: LibrarySelection, serverId?: string): string {
  return 'ref' in scope ? objectIdentity(scope.ref, serverId) : scope.kind
}
