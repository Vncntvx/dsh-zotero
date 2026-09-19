/**
 * The `zotero_attachment` domain: resolving an item or attachment ref to a
 * verified on-disk path or a protocol-checked linked URL, via Zotero's own
 * best-attachment choice with the deterministic PDF fallback.
 * @module dsh-zotero/local/attachment-location
 */

import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ZoteroHttpClient } from '../http-client.js'
import {
  errnoCodeOf,
  ZOTERO_FILE_MISSING,
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NO_ATTACHMENT,
  ZOTERO_UNEXPECTED,
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

/** Shown when a reported file location cannot be expressed as a local path. */
export const NOT_A_LOCAL_PATH_MESSAGE =
  'Zotero reported an attachment file location that is not a usable local path.'

/** The model-facing message for a location whose protocol the caller cannot open. */
export function unsupportedAttachmentProtocolMessage(
  protocol: string,
  allowedProtocols: readonly string[],
): string {
  return `Zotero reported an attachment location with unsupported protocol ${protocol}; only ${allowedProtocols
    .map((allowed) => allowed.slice(0, -1))
    .join(', ')} locations are usable.`
}

/** The model-facing message for a linked-URL attachment Zotero left without a URL. */
export function missingLinkedUrlMessage(key: string): string {
  return `Attachment ${key} is linked to a URL but Zotero reported none.`
}

/** The model-facing message for a linked-URL attachment whose URL is not a web location. */
export function notAWebLocationMessage(key: string): string {
  return `Attachment ${key} is linked to a URL that is not a usable web location.`
}

/** The model-facing message for a file attachment whose reported location is unusable. */
export function noUsableFileLocationMessage(key: string): string {
  return `Zotero reported no usable file location for attachment ${key}.`
}

/** The model-facing message for an attachment whose file is gone from disk. */
export function missingAttachmentFileMessage(path: string): string {
  return `The attachment file is missing from disk: ${path}`
}

/** The model-facing message for a target that is a different item type than the ref claims. */
export function attachmentTypeMessage(itemType: string): string {
  return `The referenced object is a ${itemType}, not an attachment.`
}

/** The model-facing message for an item ref with no attachment of any kind to resolve. */
export function noAttachmentToResolveMessage(key: string): string {
  return `Item ${key} has no attachment to resolve.`
}

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
      unsupportedAttachmentProtocolMessage(target.protocol, allowedProtocols),
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
    throw new ZoteroError(attachmentTypeMessage(itemType), ZOTERO_NO_ATTACHMENT)
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
      throw new ZoteroError(missingLinkedUrlMessage(attachmentKey), ZOTERO_NO_ATTACHMENT)
    }
    const target = parseAttachmentLocation(
      attachment.url,
      ['http:', 'https:'],
      notAWebLocationMessage(attachmentKey),
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
    noUsableFileLocationMessage(attachmentKey),
  )
  if (target.protocol === 'file:') {
    let path: string
    try {
      path = fileURLToPath(target)
    } catch (error) {
      throw new ZoteroError(NOT_A_LOCAL_PATH_MESSAGE, ZOTERO_NO_ATTACHMENT, { cause: error })
    }
    try {
      await access(path)
    } catch (error) {
      if (errnoCodeOf(error) === 'ENOENT') {
        throw new ZoteroError(missingAttachmentFileMessage(path), ZOTERO_FILE_MISSING)
      }
      // Not a named constant: no spec asserts this message, and extracting it
      // would add an uncovered function to this file's coverage floor. Same
      // rule that keeps `since.serverId must be…` inline in changes.ts.
      throw new ZoteroError(`The attachment file cannot be accessed: ${path}`, ZOTERO_UNEXPECTED, {
        cause: error,
      })
    }
    return { ref: formattedRef, title, contentType, kind: 'file', path }
  }
  return { ref: formattedRef, title, contentType, kind: 'url', url: target.toString() }
}

/**
 * Pick the attachment key an item ref resolves to: Zotero's own
 * `links.attachment` choice when present, otherwise the earliest PDF
 * child from a lazy bare `/children` fetch (notes/attachments only —
 * annotations are not attachment candidates).
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
    throw new ZoteroError(noAttachmentToResolveMessage(ref.key), ZOTERO_NO_ATTACHMENT)
  }
  return pdf.key
}
