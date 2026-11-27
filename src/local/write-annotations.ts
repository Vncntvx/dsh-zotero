/** Prepare and write native PDF annotations in the personal library. */
import { ZOTERO_WRITE_OBJECT_BATCH } from '../constants.js'
import { invalidArgs, ZoteroWriteCommitUnknownError } from '../errors.js'
import { asString, isNonNegativeSafeInteger } from '../json.js'
import { isPdfContentType } from '../media-types.js'
import { libraryPrefix, PERSONAL_LIBRARY, refStringFor, requireWritableRef } from '../refs.js'
import type {
  ZoteroCreateAnnotationsRequest,
  ZoteroCreateAnnotationsResult,
  ZoteroDeleteAnnotationRequest,
  ZoteroDeleteAnnotationResult,
} from '../types.js'
import { assertWritePayload } from '../write-bounds.js'
import type { WriteDomainDeps } from './write-deps.js'
import {
  ensureServerId,
  annotationWriteState,
  assertCurrentTextAnnotation,
  readItemForWrite,
  requireWritableRefAtServer,
  withWriteKey,
} from './write-domain.js'
import {
  batchCreateUnverified,
  receiptOfCommitUnknown,
  settleBatchCreates,
} from './write-verdicts.js'

export function annotationCreateEntries(request: ZoteroCreateAnnotationsRequest) {
  const attachment = requireWritableRef(request.attachment, ['attachment'])
  if (request.type !== 'highlight' && request.type !== 'underline')
    invalidArgs('Invalid annotation type.')
  const color = request.color.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(color)) invalidArgs('Annotation color must be a six-digit hex color.')
  if (!request.pages.length || request.pages.length > ZOTERO_WRITE_OBJECT_BATCH)
    invalidArgs(`Select text on 1 to ${ZOTERO_WRITE_OBJECT_BATCH} PDF pages.`)
  let previousPage = -1
  const entries = request.pages.map(({ pageIndex, text, pageLabel, textOffset, top, rects }) => {
    if (!isNonNegativeSafeInteger(pageIndex) || pageIndex > 99999 || pageIndex <= previousPage)
      invalidArgs('Annotation pages must be in ascending order without duplicates.')
    if (
      !isNonNegativeSafeInteger(textOffset) ||
      textOffset > 999999 ||
      !isNonNegativeSafeInteger(top) ||
      top > 99999
    )
      invalidArgs('Invalid PDF annotation sort position.')
    previousPage = pageIndex
    const annotationText = text.trim().normalize()
    if (!annotationText || !rects.length || rects.length > 1024)
      invalidArgs('Each annotated page requires text and up to 1024 selection rectangles.')
    const position = JSON.stringify({
      pageIndex,
      rects: rects.map(({ x, y, width, height }) => {
        const right = x + width
        const upper = y + height
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(right) ||
          !Number.isFinite(upper) ||
          right <= x ||
          upper <= y
        )
          invalidArgs('Invalid PDF annotation rectangle.')
        return [x, y, right, upper]
      }),
    })
    if (position.length > 65000)
      invalidArgs('The PDF annotation position exceeds the Zotero limit.')
    return {
      itemType: 'annotation',
      parentItem: attachment.key,
      annotationType: request.type,
      annotationText,
      annotationColor: color,
      annotationComment: request.comment?.trim().normalize() ?? '',
      annotationPageLabel: pageLabel.trim().normalize() || String(pageIndex + 1),
      annotationSortIndex: `${String(pageIndex).padStart(5, '0')}|${String(textOffset).padStart(6, '0')}|${String(top).padStart(5, '0')}`,
      annotationPosition: position,
    }
  })
  assertWritePayload(entries)
  return entries
}

export async function createAnnotations(
  deps: WriteDomainDeps,
  request: ZoteroCreateAnnotationsRequest,
  signal?: AbortSignal,
): Promise<ZoteroCreateAnnotationsResult> {
  const entries = annotationCreateEntries(request)
  const serverId = await ensureServerId(deps, signal)
  const attachment = requireWritableRefAtServer(request.attachment, ['attachment'], serverId)
  const parent = await readItemForWrite(
    deps,
    attachment,
    serverId,
    (data) => ({
      contentType: asString(data.contentType),
      deleted: data.deleted === true || data.deleted === 1,
      linkMode: data.linkMode,
    }),
    signal,
  )
  if (
    parent.deleted ||
    parent.itemType !== 'attachment' ||
    !isPdfContentType(parent.contentType) ||
    parent.linkMode === 'linked_url'
  )
    invalidArgs('The annotation parent must be a personal-library PDF file attachment.')

  const result: ZoteroCreateAnnotationsResult = { created: [], failed: [], unverified: [] }
  try {
    const batch = await withWriteKey(deps, serverId, signal, (apiKey) =>
      deps.writer.batch(`${libraryPrefix(PERSONAL_LIBRARY)}/items`, entries, {
        serverId,
        apiKey,
        signal,
      }),
    )
    settleBatchCreates(
      batch,
      entries,
      serverId,
      result.created,
      result.unverified,
      result.failed,
      'annotation',
    )
  } catch (error) {
    if (!(error instanceof ZoteroWriteCommitUnknownError)) throw error
    result.unverified.push(
      ...entries.map((_, index) => batchCreateUnverified(index, 'commit-unknown', serverId)),
    )
  }
  return result
}

export async function deleteAnnotation(
  deps: WriteDomainDeps,
  { annotation, expectedVersion }: ZoteroDeleteAnnotationRequest,
  signal?: AbortSignal,
): Promise<ZoteroDeleteAnnotationResult> {
  requireWritableRef(annotation, ['annotation'])
  if (!isNonNegativeSafeInteger(expectedVersion)) invalidArgs('Invalid annotation version.')
  const serverId = await ensureServerId(deps, signal)
  const { key } = requireWritableRefAtServer(annotation, ['annotation'], serverId)
  const snapshot = await readItemForWrite(deps, annotation, serverId, annotationWriteState, signal)
  assertCurrentTextAnnotation(snapshot, expectedVersion)
  try {
    const { libraryVersion } = await withWriteKey(deps, serverId, signal, (apiKey) =>
      deps.writer.delete(`${libraryPrefix(PERSONAL_LIBRARY)}/items/${key}`, {
        serverId,
        apiKey,
        ifUnmodifiedSinceVersion: expectedVersion,
        signal,
      }),
    )
    return {
      kind: 'deleted',
      ref: refStringFor(PERSONAL_LIBRARY, 'annotation', key, serverId),
      libraryVersion,
    }
  } catch (error) {
    return receiptOfCommitUnknown(error, { kind: 'annotation', key, serverId })
  }
}
