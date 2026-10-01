/**
 * The `zotero_export` domain: citations batched to the API's itemKey cap,
 * the CSL-sorted bibliography, and the translator formats whose per-document
 * entries are located server-side against the merged batch body.
 * @module dsh-zotero/local/export-domain
 */

import type { ZoteroHttpClient } from '../http-client.js'
import { ZOTERO_ITEMKEY_BATCH } from '../constants.js'
import {
  ZOTERO_INVALID_ARGUMENT,
  ZOTERO_NOT_FOUND,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_UNEXPECTED,
  SERVER_MISMATCH_MESSAGE,
  ZoteroError,
} from '../errors.js'
import { asRecord, asString, isObjectKey } from '../json.js'
import { ITEM_WITHOUT_KEY_MESSAGE } from '../normalize.js'
import { locateExportItemsFromBatch } from '../export-mapping.js'
import {
  formatRef,
  libraryPrefix,
  sameLibrary,
  requireSupportedLocalRef,
  PERSONAL_LIBRARY,
} from '../refs.js'
import type { LocalApiLimits } from './limits.js'
import type {
  SupportedLocalLibrary,
  ZoteroExportFormat,
  ZoteroExportItem,
  ZoteroExportRequest,
  ZoteroExportResult,
  ZoteroObjectRef,
  ZoteroProgressEvent,
} from '../types.js'

/**
 * Export the requested items through the Local API's format pipeline:
 * `include=citation` pairs each item with its HTML citation (batched to the
 * API's itemKey cap when the request is larger), `format=bib` yields a
 * joined CSL-sorted bibliography, and the translator formats
 * (`bibtex`/`biblatex`/`ris`/`csljson`) export the whole set at once. The
 * batch-breaking formats refuse to exceed `ZOTERO_ITEMKEY_BATCH` — their
 * global ordering belongs to Zotero, so splitting them would silently
 * reorder the output. The translator formats itemize each document by
 * locating it directly within the batch body in memory — pairing each ref
 * with its citation key, span offsets, and display title where possible,
 * and falling back gracefully to a bare ref if an item is omitted by the
 * translator output. Output that exceeds `maxExportChars` fails with
 * OUTPUT_TOO_LARGE — export text is never mid-truncated.
 */
export async function exportItems(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  request: ZoteroExportRequest,
  signal?: AbortSignal,
  onProgress?: (progress: ZoteroProgressEvent) => void,
): Promise<ZoteroExportResult> {
  for (const ref of request.refs) requireSupportedLocalRef(ref, ['item'])
  // Export is single-library (v3 lock): all refs must share the same SupportedLocalLibrary
  const firstLibrary = request.refs[0]?.library as SupportedLocalLibrary | undefined
  if (firstLibrary !== undefined) {
    for (const ref of request.refs.slice(1)) {
      if (!sameLibrary(firstLibrary, ref.library as SupportedLocalLibrary)) {
        throw new ZoteroError(
          'All refs in one export must belong to the same library (personal or a single group). Split by library.',
          ZOTERO_INVALID_ARGUMENT,
        )
      }
    }
  }
  // Every ref must come from the same Zotero instance: the request header
  // carries one identity, and a ref from another instance must fail closed
  // instead of silently resolving same-key objects there.
  const serverIds = new Set(
    request.refs.map((ref) => ref.serverId).filter((id): id is string => id !== undefined),
  )
  if (serverIds.size > 1) throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH)
  const serverId = serverIds.size === 1 ? serverIds.values().next().value : undefined
  const exportLibrary: SupportedLocalLibrary = (firstLibrary ??
    PERSONAL_LIBRARY) as SupportedLocalLibrary
  const exportPrefix = libraryPrefix(exportLibrary)
  const style = request.style ?? deps.limits.defaultStyle
  const locale = request.locale ?? deps.limits.defaultLocale
  if (request.format === 'citation') {
    return await exportCitations(
      deps,
      request.refs,
      exportPrefix,
      serverId,
      style,
      locale,
      signal,
      onProgress,
    )
  }
  // Duplicate refs name the same item; the translator formats fetch each
  // document on its own, so every unique key is requested once, keeping
  // the first-seen order. Dedupe by canonical ref (library+key), not bare key.
  const seen = new Set<string>()
  const refs: ZoteroObjectRef[] = []
  for (const ref of request.refs) {
    const canonical = `${ref.library.type}:${ref.library.id}:${ref.key}`
    if (seen.has(canonical)) continue
    seen.add(canonical)
    refs.push(ref)
  }
  if (refs.length > ZOTERO_ITEMKEY_BATCH) {
    throw new ZoteroError(
      `The ${request.format} format accepts at most ${ZOTERO_ITEMKEY_BATCH} item refs per call (Zotero's itemKey request cap, which also keeps the format's global ordering intact). Request up to ${ZOTERO_ITEMKEY_BATCH} refs at a time, or use citation, which batches up to the configured export cap.`,
      ZOTERO_INVALID_ARGUMENT,
    )
  }
  onProgress?.({
    phase: 'fetch_batch',
    current: 0,
    total: refs.length,
    message: `Fetching ${refs.length} items (${request.format})...`,
  })
  const search = new URLSearchParams()
  search.set('itemKey', refs.map((ref) => ref.key).join(','))
  if (request.format === 'bibliography') {
    search.set('format', 'bib')
    search.set('style', style)
    search.set('locale', locale)
  } else {
    search.set('format', request.format)
  }
  const isBibtexFamily = request.format === 'bibtex' || request.format === 'biblatex'
  const exportPromise = deps.client.get(`${exportPrefix}/items`, search, { signal, serverId })
  const metaPromise = isBibtexFamily
    ? fetchRawItemBatch(deps.client, exportPrefix, refs, signal, serverId)
    : Promise.resolve<readonly Record<string, unknown>[]>([])

  const [{ body }, rawItems] = await Promise.all([exportPromise, metaPromise])
  if (body.length > deps.limits.maxExportChars) {
    throw new ZoteroError(
      `Export output of ${body.length} characters exceeds the ${deps.limits.maxExportChars}-character export limit.`,
      ZOTERO_OUTPUT_TOO_LARGE,
    )
  }
  if (request.format === 'bibliography') {
    return { format: 'bibliography', style, locale, text: body }
  }
  // The browser holds `text` with its leading whitespace trimmed (the
  // render strips it), so the entry offsets are measured on that same
  // trimmed body.
  const items = locateExportItemsFromBatch(request.format, body.trimStart(), refs, rawItems)
  return { format: request.format, text: body, items }
}

async function fetchRawItemBatch(
  client: ZoteroHttpClient,
  prefix: string,
  refs: readonly ZoteroObjectRef[],
  signal: AbortSignal | undefined,
  serverId: string | undefined,
): Promise<readonly Record<string, unknown>[]> {
  const search = new URLSearchParams()
  search.set('itemKey', refs.map((ref) => ref.key).join(','))
  try {
    const { json } = await client.getJson<unknown>(`${prefix}/items`, search, { signal, serverId })
    if (Array.isArray(json)) {
      return json
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== undefined)
    }
  } catch {
    // Fail-open for metadata: if raw JSON fetch fails, alignment still proceeds with
    // available fields and direct keys without failing the export.
  }
  return []
}

/**
 * Citation export: batches the refs into API-sized requests, merges the
 * per-key citations, and reorders them to the requested sequence. Order is
 * exact — each citation stays paired with its ref — so batching is
 * invisible to the caller.
 */
async function exportCitations(
  deps: { client: ZoteroHttpClient; limits: LocalApiLimits },
  refs: readonly ZoteroObjectRef[],
  prefix: string,
  serverId: string | undefined,
  style: string,
  locale: string,
  signal: AbortSignal | undefined,
  onProgress?: (progress: ZoteroProgressEvent) => void,
): Promise<ZoteroExportResult> {
  const citationByKey = new Map<string, string>()
  for (let start = 0; start < refs.length; start += ZOTERO_ITEMKEY_BATCH) {
    const batch = refs.slice(start, start + ZOTERO_ITEMKEY_BATCH)
    onProgress?.({
      phase: 'citation_batch',
      current: start,
      total: refs.length,
      message: `Exporting citations ${start}/${refs.length}...`,
    })
    const batchCitations = await fetchCitationBatch(
      deps,
      batch,
      prefix,
      serverId,
      style,
      locale,
      signal,
    )
    for (const [key, text] of batchCitations) citationByKey.set(key, text)
  }
  onProgress?.({
    phase: 'citation_batch',
    current: refs.length,
    total: refs.length,
    message: `Exported ${refs.length}/${refs.length} citations`,
  })
  const citations = refs.map((ref) => {
    const text = citationByKey.get(ref.key)
    if (text === undefined) {
      throw new ZoteroError(
        `Zotero did not return an item for ${formatRef(ref)}.`,
        ZOTERO_NOT_FOUND,
      )
    }
    return { ref: formatRef(ref), text }
  })
  const totalChars = citations.reduce((sum, entry) => sum + entry.text.length, 0)
  if (totalChars > deps.limits.maxExportChars) {
    throw new ZoteroError(
      `Citation output of ${totalChars} characters exceeds the ${deps.limits.maxExportChars}-character export limit.`,
      ZOTERO_OUTPUT_TOO_LARGE,
    )
  }
  return { format: 'citation', style, locale, citations }
}

/** One batch of per-key citations — at most `ZOTERO_ITEMKEY_BATCH` keys. */
async function fetchCitationBatch(
  deps: { client: ZoteroHttpClient },
  batch: readonly ZoteroObjectRef[],
  prefix: string,
  serverId: string | undefined,
  style: string,
  locale: string,
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const search = new URLSearchParams()
  search.set('itemKey', batch.map((ref) => ref.key).join(','))
  search.set('include', 'citation')
  search.set('style', style)
  search.set('locale', locale)
  const { json } = await deps.client.getJson<unknown>(`${prefix}/items`, search, {
    signal,
    serverId,
  })
  const citationByKey = new Map<string, string>()
  for (const row of Array.isArray(json) ? json : []) {
    const record = asRecord(row)
    const key = asString(record?.key)
    if (key === undefined || !isObjectKey(key)) {
      throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED)
    }
    citationByKey.set(key, asString(record?.citation) ?? '')
  }
  return citationByKey
}
