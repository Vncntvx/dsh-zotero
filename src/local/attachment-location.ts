/**
 * The `zotero_attachment` domain: resolving an item or attachment ref to a
 * verified on-disk path or a protocol-checked linked URL, via Zotero's own
 * best-attachment choice with the deterministic PDF fallback.
 * @module dsh-zotero/local/attachment-location
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ZoteroHttpClient } from '../http-client.js'
import {
  ZOTERO_FILE_MISSING,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NO_ATTACHMENT,
  ZoteroError,
} from '../errors.js'
import { asRecord, asString } from '../json.js'
import {
  normalizeAttachmentRecord,
  bestAttachmentFromLinks,
  selectAttachments,
} from '../attachments.js'
import { formatRef, libraryPrefix, refForLibrary, requireSupportedLocalRef } from '../refs.js'
import type { LocalApiLimits } from './limits.js'
import type { SupportedLocalLibrary, ZoteroAttachmentLocation, ZoteroObjectRef } from '../types.js'

/**
 * Parse a location the Local API reported for an attachment and require one
 * of the allowed protocols. Malformed text, relative paths, and exotic
 * schemes fail the call instead of leaking an unopenable location into tool
 * output; the failure message names the allowed protocols so the model can
 * act on the boundary.
 * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the value is not a usable location.
 */
function parseAttachmentLocation(
  raw: string,
  allowedProtocols: readonly string[],
  parseFailureMessage: string,
): URL {
  let target: URL
  try {
    target = new URL(raw)
  } catch (error) {
    throw new ZoteroError(parseFailureMessage, ZOTERO_NO_ATTACHMENT, { cause: error })
  }
  if (!allowedProtocols.includes(target.protocol)) {
    throw new ZoteroError(
      `Zotero reported an attachment location with unsupported protocol ${target.protocol}; only ${allowedProtocols
        .map((protocol) => protocol.slice(0, -1))
        .join(', ')} locations are usable.`,
      ZOTERO_NO_ATTACHMENT,
    )
  }
  return target
}

/**
 * Resolve an item or attachment ref to a usable location. An item ref
 * follows Zotero's own best-attachment link first and falls back to the
 * earliest PDF child, so callers do not need the attachment's key when
 * one attachment is enough. Linked-URL attachments carry their target in
 * `data.url` (their `/file/view/url` endpoint rejects non-file
 * attachments); file attachments resolve through `/file/view/url` and
 * are stat'ed so a missing file fails with a typed error instead of a
 * dead path.
 */
export async function getAttachmentLocation(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  ref: ZoteroObjectRef,
  signal?: AbortSignal,
): Promise<ZoteroAttachmentLocation> {
  const local = requireSupportedLocalRef(ref, ['item', 'attachment'])
  const attachmentKey = await resolveAttachmentKey(deps, local, signal)
  const prefix = libraryPrefix(local.library as SupportedLocalLibrary)
  const item = await deps.client.getJson<unknown>(`${prefix}/items/${attachmentKey}`, undefined, {
    signal,
    serverId: local.serverId,
  })
  const data = asRecord(asRecord(item.json)?.data)
  const itemType = asString(data?.itemType)
  if (itemType !== undefined && itemType !== 'attachment') {
    throw new ZoteroError(
      `The referenced object is a ${itemType}, not an attachment.`,
      ZOTERO_NO_ATTACHMENT,
    )
  }
  const attachment = normalizeAttachmentRecord(item.json)
  const serverId = item.headers.get('zotero-server-id') ?? local.serverId
  const formattedRef = formatRef(
    refForLibrary(local.library as SupportedLocalLibrary, 'attachment', attachment.key, serverId),
  )
  const title = attachment.title
  const contentType = attachment.contentType
  if (attachment.linkMode === 'linked_url') {
    if (attachment.url === undefined || attachment.url === '') {
      throw new ZoteroError(
        `Attachment ${attachmentKey} is linked to a URL but Zotero reported none.`,
        ZOTERO_NO_ATTACHMENT,
      )
    }
    const target = parseAttachmentLocation(
      attachment.url,
      ['http:', 'https:'],
      `Attachment ${attachmentKey} is linked to a URL that is not a usable web location.`,
    )
    return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
  }
  const file = await deps.client.get(`${prefix}/items/${attachmentKey}/file/view/url`, undefined, {
    signal,
    serverId: local.serverId,
  })
  const target = parseAttachmentLocation(
    file.body.trim(),
    ['file:', 'http:', 'https:'],
    `Zotero reported no usable file location for attachment ${attachmentKey}.`,
  )
  if (target.protocol === 'file:') {
    const path = fileURLToPath(target)
    if (!existsSync(path)) {
      throw new ZoteroError(
        `The attachment file is missing from disk: ${path}`,
        ZOTERO_FILE_MISSING,
      )
    }
    return { ref: formattedRef, title, contentType, kind: 'file', path }
  }
  return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
}

/**
 * Pick the attachment key an item ref resolves to: Zotero's own
 * `links.attachment` choice when present, otherwise the earliest PDF
 * child from a lazy `/children` fetch.
 * @throws {ZoteroError} `ZOTERO_NO_ATTACHMENT` when the item has none.
 */
async function resolveAttachmentKey(
  deps: { client: ZoteroHttpClient },
  ref: ZoteroObjectRef,
  signal?: AbortSignal,
): Promise<string> {
  if (ref.kind === 'attachment') return ref.key
  const prefix = libraryPrefix(ref.library as SupportedLocalLibrary)
  const parent = await deps.client.getJson<unknown>(`${prefix}/items/${ref.key}`, undefined, {
    signal,
    serverId: ref.serverId,
  })
  const link = bestAttachmentFromLinks(parent.json)
  if (link !== undefined) return link.key
  const children = await deps.client.getJson<unknown>(
    `${prefix}/items/${ref.key}/children`,
    undefined,
    {
      signal,
      serverId: ref.serverId,
    },
  )
  const pdf = selectAttachments(Array.isArray(children.json) ? children.json : [], 'pdf')[0]
  if (pdf === undefined) {
    throw new ZoteroError(`Item ${ref.key} has no attachment to resolve.`, ZOTERO_NO_ATTACHMENT)
  }
  return pdf.key
}
