/** Resolve a local document's attachment and parent from actual Zotero metadata. */
import type { ZoteroHttpClient } from '../http-client.js'
import { asRecord, asString, isObjectKey } from '../json.js'
import { normalizeSearchItem } from '../normalize-search.js'
import { formatRef, libraryPrefix, parseSupportedRef, refStringFor } from '../refs.js'
import { ZoteroError, ZOTERO_UNEXPECTED } from '../errors.js'
import type { SupportedLocalLibrary, ZoteroFulltextItem } from '../types.js'

export interface FulltextIdentity {
  readonly attachmentRef: string
  readonly attachmentContentType?: string
  readonly item?: ZoteroFulltextItem
}

export async function fulltextIdentityOf(
  client: ZoteroHttpClient,
  attachment: string,
  signal?: AbortSignal,
): Promise<FulltextIdentity> {
  const ref = parseSupportedRef(attachment, ['attachment'])
  const library = ref.library as SupportedLocalLibrary
  const prefix = libraryPrefix(library)
  const { json } = await client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
    signal,
    serverId: ref.serverId,
  })
  const record = asRecord(json),
    data = asRecord(record?.data)
  if (record?.key !== ref.key || data?.itemType !== 'attachment')
    throw new ZoteroError(
      'Zotero returned different or invalid fulltext attachment metadata.',
      ZOTERO_UNEXPECTED,
    )
  const serverId = client.serverId ?? ref.serverId
  const attachmentRef = refStringFor(library, 'attachment', ref.key, serverId)
  const attachmentContentType = asString(data.contentType)
  const identity = {
    attachmentRef,
    ...(attachmentContentType === undefined ? {} : { attachmentContentType }),
  }
  if (data.parentItem === undefined || data.parentItem === false || data.parentItem === '')
    return identity
  const parent = asString(data.parentItem)
  if (parent === undefined || !isObjectKey(parent))
    throw new ZoteroError(
      'Zotero returned an invalid parent for the fulltext attachment.',
      ZOTERO_UNEXPECTED,
    )
  const { json: parentJson } = await client.getJson<unknown>(
    `${prefix}/items/${parent}`,
    undefined,
    { signal, serverId },
  )
  const parentRecord = asRecord(parentJson),
    parentData = asRecord(parentRecord?.data)
  if (
    parentRecord?.key !== parent ||
    !asString(parentData?.itemType) ||
    ['attachment', 'note', 'annotation'].includes(String(parentData?.itemType))
  )
    throw new ZoteroError(
      `Zotero returned invalid parent metadata for ${formatRef(ref)}.`,
      ZOTERO_UNEXPECTED,
    )
  const normalized = normalizeSearchItem(parentJson, { library, serverId })
  return {
    ...identity,
    item: {
      ref: normalized.ref,
      title: normalized.title,
      creatorSummary: normalized.creatorSummary,
      ...(normalized.year === undefined ? {} : { year: normalized.year }),
      ...(normalized.venue === undefined ? {} : { venue: normalized.venue }),
    },
  }
}
