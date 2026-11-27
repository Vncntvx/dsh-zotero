/**
 * Create, update and delete Zotero note items.
 * @module dsh-zotero/local/write-notes
 */

import {
  WRITE_CONFLICT_MESSAGE,
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_WRITE_CONFLICT,
  ZoteroError,
  invalid,
  requireNonBlank,
} from '../errors.js'
import { asRecord, asString, isNonNegativeSafeInteger } from '../json.js'
import {
  formatZoteroRelationUri,
  libraryPrefix,
  PERSONAL_LIBRARY,
  relationTargetRef,
  requireSupportedLocalRef,
  requireWritableRef,
} from '../refs.js'
import type {
  ZoteroCreateNoteCommittedOutcome,
  ZoteroCreateNoteRequest,
  ZoteroModifyNoteRequest,
  ZoteroUpdateNoteRequest,
  ZoteroUpdateNoteResult,
  ZoteroWriteCommittedUnverified,
} from '../types.js'
import { markdownToNoteHtml } from './note-format.js'
import { applyNoteTextEdits } from './note-text-edits.js'
import { submittedFieldsMatch } from './write-content-proof.js'
import { committedUnverified, receiptOfCommitUnknown, settleCreate } from './write-verdicts.js'
import type { WriteDomainDeps } from './write-deps.js'
import { collectionRef, itemRef } from './write-refs.js'
import {
  ensureServerId,
  normalizeCollectionInput,
  normalizeWriteList,
  readItemForWrite,
  requireSupportedRefAtServer,
  requireWritableRefAtServer,
  tagsOf,
  strictCollectionKeysOf,
  withItemStateWrite,
  withWriteKey,
} from './write-domain.js'

const DC_RELATION = 'dc:relation'

function relationUrisOf(data: Record<string, unknown>): string[] {
  const raw = asRecord(data['relations'])?.[DC_RELATION]
  if (typeof raw === 'string') return [raw]
  return Array.isArray(raw)
    ? raw.map(asString).filter((value): value is string => value !== undefined)
    : []
}

function relationUriToRef(uri: string, serverId: string): string {
  return relationTargetRef(uri, serverId, { personalContext: true }) ?? uri
}

export async function createNote(
  deps: WriteDomainDeps,
  request: ZoteroCreateNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateNoteCommittedOutcome> {
  requireNonBlank('markdown', request.markdown)
  const localParent =
    request.parentItem === undefined ? undefined : requireWritableRef(request.parentItem, ['item'])
  const collectionInputs = (request.collections ?? []).map((value) =>
    normalizeCollectionInput('collections', value),
  )
  const localSources = (request.sourceRefs ?? []).map((ref) =>
    requireSupportedLocalRef(ref, ['item']),
  )
  const tags = normalizeWriteList('tags', request.tags ?? [])
  if (localParent !== undefined && collectionInputs.length > 0) {
    throw new ZoteroError(WRITE_CHILD_COLLECTIONS_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }

  const serverId = await ensureServerId(deps, signal)
  const parent =
    localParent === undefined
      ? undefined
      : requireWritableRefAtServer(localParent, ['item'], serverId)
  const collections = (await deps.resolveCollections(collectionInputs, signal)).map((ref) =>
    requireWritableRefAtServer(ref, ['collection'], serverId),
  )
  const sources = localSources.map((ref) => requireSupportedRefAtServer(ref, ['item'], serverId))
  const entry: Record<string, unknown> = {
    itemType: 'note',
    note: markdownToNoteHtml(request.markdown),
    ...(parent !== undefined ? { parentItem: parent.key } : {}),
    ...(tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : {}),
    ...(parent === undefined && collections.length > 0
      ? { collections: collections.map((ref) => ref.key) }
      : {}),
    ...(sources.length > 0
      ? { relations: { [DC_RELATION]: sources.map((ref) => formatZoteroRelationUri(ref)) } }
      : {}),
  }
  return await withWriteKey(deps, serverId, signal, async (apiKey) => {
    const prove = (data: Record<string, unknown>) => {
      if (
        data.itemType !== 'note' ||
        typeof data.note !== 'string' ||
        !submittedFieldsMatch(data, entry) ||
        (parent !== undefined && data.parentItem !== parent.key) ||
        (parent === undefined && data.parentItem !== undefined)
      )
        return undefined
      const savedTags = tagsOf(data)
      const savedCollections = strictCollectionKeysOf(data)
      if (savedTags === undefined || savedCollections === undefined) return undefined
      return {
        savedTags: savedTags.map((tag) => tag.tag),
        savedCollections,
        savedRelations: relationUrisOf(data),
      }
    }
    const settled = await settleCreate(
      deps,
      {
        path: `${libraryPrefix(PERSONAL_LIBRARY)}/items`,
        entry,
        serverId,
        apiKey,
        signal,
        kind: 'note',
      },
      prove,
    )
    if (settled.status === 'unverified') return settled.result
    const { key, version, payload } = settled.entry
    return {
      kind: 'applied',
      ref: itemRef(key, serverId),
      key,
      version,
      ...(parent !== undefined ? { parentItem: itemRef(parent.key, serverId) } : {}),
      collections:
        parent === undefined
          ? payload.savedCollections.map((collectionKey) => collectionRef(collectionKey, serverId))
          : [],
      tags: payload.savedTags,
      sourceRefs: payload.savedRelations.map((uri) => relationUriToRef(uri, serverId)),
      libraryVersion: settled.entry.libraryVersion,
      serverId,
    }
  })
}

export async function updateNote(
  deps: WriteDomainDeps,
  request: ZoteroUpdateNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateNoteResult | ZoteroWriteCommittedUnverified> {
  const markdown = requireNonBlank('markdown', request.markdown)
  const localRef = requireWritableRef(request.item, ['item'])
  return await withItemStateWrite(
    deps,
    localRef,
    signal,
    () => ({}),
    async ({ snapshot, serverId, resultRef, send }) => {
      if (snapshot.itemType !== 'note') {
        throw new ZoteroError('The target item is not a Zotero note.', ZOTERO_INVALID_ARGUMENT)
      }
      let libraryVersion: number
      try {
        ;({ libraryVersion } = await send({ note: markdownToNoteHtml(markdown) }))
      } catch (error) {
        return receiptOfCommitUnknown(error, { kind: 'note', key: localRef.key, serverId })
      }
      return { kind: 'applied', ref: resultRef, version: libraryVersion, libraryVersion, serverId }
    },
  )
}

function noteWriteState(data: Record<string, unknown>) {
  return { html: asString(data.note), deleted: data.deleted === true || data.deleted === 1 }
}

export async function modifyNote(
  deps: WriteDomainDeps,
  request: ZoteroModifyNoteRequest,
  signal?: AbortSignal,
): Promise<ZoteroUpdateNoteResult | ZoteroWriteCommittedUnverified> {
  const item = requireWritableRef(request.item, ['item'])
  const { expectedVersion } = request
  if (!isNonNegativeSafeInteger(expectedVersion)) invalid('Invalid note version.')
  return await withItemStateWrite(
    deps,
    item,
    signal,
    noteWriteState,
    async ({ snapshot, serverId, resultRef, send }) => {
      if (snapshot.itemType !== 'note') invalid('The target item is not a Zotero note.')
      if (snapshot.deleted) throw new ZoteroError('The note is in the Trash.', ZOTERO_NOT_FOUND)
      if (snapshot.version !== expectedVersion)
        throw new ZoteroError(WRITE_CONFLICT_MESSAGE, ZOTERO_WRITE_CONFLICT)
      const receipt = { kind: 'note' as const, key: item.key, serverId }
      let libraryVersion: number
      if (request.operation === 'delete') {
        try {
          ;({ libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
            deps.writer.delete(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${item.key}`, {
              serverId,
              apiKey,
              ifUnmodifiedSinceVersion: expectedVersion,
              signal,
            }),
          ))
        } catch (error) {
          return receiptOfCommitUnknown(error, receipt)
        }
      } else {
        if (snapshot.html === undefined) invalid('The note has no editable HTML.')
        const note = applyNoteTextEdits(snapshot.html, request.edits)
        if (note === snapshot.html)
          return {
            kind: 'applied',
            ref: resultRef,
            version: expectedVersion,
            libraryVersion: expectedVersion,
            serverId,
          }
        try {
          ;({ libraryVersion } = await send({ note, version: expectedVersion }))
        } catch (error) {
          return receiptOfCommitUnknown(error, receipt)
        }
        const verified = await readItemForWrite(deps, item, serverId, noteWriteState, signal)
          .then(
            (saved) =>
              !saved.deleted &&
              saved.itemType === 'note' &&
              saved.version === libraryVersion &&
              (saved.html === note || submittedFieldsMatch({ note: saved.html }, { note })),
          )
          .catch(() => false)
        if (!verified) return committedUnverified({ ...receipt, version: libraryVersion })
      }
      return { kind: 'applied', ref: resultRef, version: libraryVersion, libraryVersion, serverId }
    },
  )
}
