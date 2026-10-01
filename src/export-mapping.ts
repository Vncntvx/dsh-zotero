/**
 * Server-side ref → batch-entry mapping for translator exports. The merged
 * body's entry order belongs to Zotero, and citation keys are generated in
 * the export context, so the browser never guesses again: the provider
 * parses entries directly from the batch export body in memory, locating
 * each requested item by citation key, item key, or identifier.
 * @module dsh-zotero/export-mapping
 */

import { parseExportItem } from './export-items.js'
import { formatRef } from './refs.js'
import type { ZoteroExportFormat, ZoteroObjectRef } from './types.js'

/** One located entry of a translator export body. */
export interface BatchEntry {
  /** The entry's key: BibTeX/BibLaTeX citation key, RIS record id, or CSL JSON id. */
  readonly key?: string
  /** The entry's start offset within the body. */
  readonly start: number
  /** The entry's end offset (exclusive) within the body. */
  readonly end: number
  /** The entry's own text, trimmed. */
  readonly text: string
}

/** The per-document item of one export call: the ref plus its located entry. */
export interface LocatedExportItem {
  readonly ref: string
  /** The batch body's real key (BibTeX/BibLaTeX citation key, CSL JSON id). */
  readonly key?: string
  /** The item's title for display, when the entry carried one. */
  readonly title?: string
  /** The located entry's index within the parsed CSL JSON array. */
  readonly entryIndex?: number
  /** The located entry's text span within the trimmed batch body (text formats). */
  readonly start?: number
  readonly end?: number
}

/** The start of one entry: `@type{` in letters, anywhere in the body. */
const ENTRY_START = /@[A-Za-z]+\{/g
// Line endings ride along in `^…$` matches, so the terminator tolerates the
// carriage return Zotero builds that emit CRLF leave behind.
const RIS_RECORD_END = /^ER  -[ ]?\r?$/gm
const RIS_ID = /^ID  - (.+?)\r?$/m

/** The entry's citation key: the run after `@type{` up to a comma, brace, or whitespace. */
function entryKeyOf(text: string, from: number): string | undefined {
  let end = from
  while (end < text.length && !/[,\s{}]/.test(text[end]!)) end += 1
  return end === from ? undefined : text.slice(from, end)
}

/**
 * The offset just past the `}` closing the entry that starts at `from` (the
 * entry's opening `@type{` brace). Field values nest braces and may carry
 * quoted strings; a quote only opens at field-value level — inside braces it
 * is a literal character — and a body that never closes runs to the text end.
 */
function entryEndOf(text: string, from: number): number {
  let depth = 1
  let inString = false
  let cursor = from
  while (cursor < text.length) {
    const char = text[cursor]!
    if (inString) {
      if (char === '"') inString = false
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return cursor + 1
    } else if (char === '"' && depth === 1) {
      inString = true
    }
    cursor += 1
  }
  return text.length
}

/**
 * Split a BibTeX/BibLaTeX body into its entries with their text spans. Each
 * entry's `text` runs from its `@type{` start to its own closing brace, so
 * trailing `%` comments or blank lines before the next entry never join the
 * body — each entry alone is what title parsing reads. The `end` offset
 * still tiles the body to the next entry's start (or the body end) for UI
 * span highlighting. The scan is progressive and brace-aware: every entry's
 * body is skipped to its closing brace before the next start is searched, so
 * an `@type{key,` shape inside a field value, a quoted string, or a comment
 * never starts a new entry.
 * @param text - the export body (offsets are relative to this string).
 * @returns the entries in body order.
 */
export function splitBibtexEntries(text: string): BatchEntry[] {
  const starts: { readonly key?: string; readonly index: number; readonly entryEnd: number }[] = []
  let cursor = 0
  for (;;) {
    ENTRY_START.lastIndex = cursor
    const start = ENTRY_START.exec(text)
    if (start === null) break
    const key = entryKeyOf(text, start.index + start[0].length)
    const entryEnd = entryEndOf(text, start.index + start[0].length)
    starts.push({
      ...(key === undefined ? {} : { key }),
      index: start.index,
      entryEnd,
    })
    cursor = Math.max(entryEnd, start.index + start[0].length)
    if (entryEnd >= text.length) break
  }
  const entries: BatchEntry[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!
    const end = starts[index + 1]?.index ?? text.length
    entries.push({
      ...(start.key === undefined ? {} : { key: start.key }),
      start: start.index,
      end,
      // Body alone (to the closing brace): inter-entry comments and blank
      // lines stay out so title parsing reads one entry. `end` still covers
      // the gap for UI span highlighting.
      text: text.slice(start.index, start.entryEnd).trim(),
    })
  }
  return entries
}

/** The next record's start: the first non-blank line after `offset`. */
function nextRecordStart(text: string, offset: number): number {
  let cursor = offset
  while (cursor < text.length) {
    const lineEnd = text.indexOf('\n', cursor)
    const end = lineEnd === -1 ? text.length : lineEnd + 1
    if (text.slice(cursor, end).trim() === '') {
      cursor = end
      continue
    }
    return cursor
  }
  return cursor
}

/**
 * Split an RIS body into its records with their text spans. Each record
 * runs from the previous terminator (the body start for the first) to the
 * start of the next record, its `ER` terminator line and any blank lines
 * after it included — every record's own text is a complete RIS record,
 * and the slices tile the body exactly. A trailing record without a
 * terminator runs to the body end.
 * @param text - the export body (offsets are relative to this string).
 * @returns the records in body order.
 */
export function splitRisRecords(text: string): BatchEntry[] {
  const records: BatchEntry[] = []
  let recordStart = 0
  for (const match of text.matchAll(RIS_RECORD_END)) {
    const start = recordStart
    const end = nextRecordStart(text, match.index + match[0].length)
    recordStart = end
    const record = text.slice(start, end)
    const id = RIS_ID.exec(record)?.[1]?.trim()
    records.push({
      ...(id === undefined || id === '' ? {} : { key: id }),
      start,
      end,
      text: record.trim(),
    })
  }
  const tail = text.slice(recordStart)
  if (tail.trim() !== '') {
    const id = RIS_ID.exec(tail)?.[1]?.trim()
    records.push({
      ...(id === undefined || id === '' ? {} : { key: id }),
      start: recordStart,
      end: text.length,
      text: tail.trim(),
    })
  }
  return records
}

/**
 * Locate items directly from the batch export body in memory without
 * secondary HTTP calls. Match priority per ref is fixed:
 *
 * 1. Direct key match: a BibTeX/BibLaTeX entry whose citation key equals the
 *    ref key, an RIS record whose `ID` equals it, a CSL-JSON record whose
 *    `id` equals it bare or carries it after the last `/` (Zotero serves
 *    `http://zotero.org/…/items/<KEY>` ids).
 * 2. Mention match (BibTeX/BibLaTeX only): the key appears as a whole token
 *    inside the entry body — the export context mints custom citation keys,
 *    but the body still names the item key (file paths, `note` fields).
 *    Token means `[A-Za-z0-9_]+`, the same class `\b` uses, so matching is
 *    injection-safe and never equates `XABCD1234` with `ABCD1234`.
 * 3. Positional fallback only for the unambiguous case: exactly one ref and
 *    exactly one entry. Anything else unlocatable yields a bare `{ref}` —
 *    the call succeeds, the UI reports the gap per item instead of failing
 *    the whole export.
 *
 * Direct matches claim entries first (each entry serves at most one ref, in
 * requested order); mentions only consider still-unclaimed entries.
 * @param format - the translator format of the batch body.
 * @param text - the trimmed batch body, exactly as the browser will hold it.
 * @param refs - the requested refs, in order.
 * @returns the located items, one per ref.
 */
export function locateExportItemsFromBatch(
  format: ZoteroExportFormat,
  text: string,
  refs: readonly ZoteroObjectRef[],
): LocatedExportItem[] {
  if (format === 'bibtex' || format === 'biblatex') return locateBibtexFromBatch(text, refs, format)
  if (format === 'ris') return locateRisFromBatch(text, refs)
  if (format === 'csljson') return locateCslFromBatch(text, refs)
  return refs.map((ref) => ({ ref: formatRef(ref) }))
}

/**
 * Index batch entries for O(1) per-ref lookup: citation keys map to entry
 * indices, and whole-word mention tokens map to the entries containing them.
 * Built once per export body — refs then resolve without rescanning entry
 * text. The token index covers only the requested ref keys (≤50): indexing
 * every word in the body would be O(total body tokens) time and memory for
 * O(refs) lookups, bounded only by `maxExportChars`.
 */
interface BatchIndex {
  /** Entries whose citation key equals the map key, in body order. */
  readonly byKey: ReadonlyMap<string, readonly number[]>
  /** Entries whose body contains the map key as a whole token, in body order. */
  readonly byToken: ReadonlyMap<string, readonly number[]>
}

function indexBibtexEntries(
  entries: readonly BatchEntry[],
  wanted: ReadonlySet<string>,
): BatchIndex {
  const byKey = new Map<string, number[]>()
  const byToken = new Map<string, number[]>()
  if (wanted.size === 0) return { byKey, byToken }
  entries.forEach((entry, index) => {
    if (entry.key !== undefined) {
      const bucket = byKey.get(entry.key) ?? []
      bucket.push(index)
      byKey.set(entry.key, bucket)
    }
    // Split on non-word runs instead of a shared `/g` match: no mutable
    // `lastIndex` state to reset, and the token class stays the `\b` class
    // (`[A-Za-z0-9_]+`) so `XABCD1234` never equals `ABCD1234`.
    const seen = new Set<string>()
    for (const word of entry.text.split(/[^A-Za-z0-9_]+/)) {
      if (word === '' || !wanted.has(word) || seen.has(word)) continue
      seen.add(word)
      const bucket = byToken.get(word) ?? []
      bucket.push(index)
      byToken.set(word, bucket)
    }
  })
  return { byKey, byToken }
}

/** First index in `candidates` not yet claimed, or undefined when none remains. */
function firstUnclaimed(
  candidates: readonly number[] | undefined,
  used: ReadonlySet<number>,
): number | undefined {
  if (candidates === undefined) return undefined
  for (const index of candidates) {
    if (!used.has(index)) return index
  }
  return undefined
}

function locateBibtexFromBatch(
  text: string,
  refs: readonly ZoteroObjectRef[],
  format: ZoteroExportFormat,
): LocatedExportItem[] {
  const batchEntries = splitBibtexEntries(text)
  const wanted = new Set(refs.map((ref) => ref.key))
  const { byKey, byToken } = indexBibtexEntries(batchEntries, wanted)
  const used = new Set<number>()
  return refs.map((ref) => {
    const formattedRef = formatRef(ref)
    // Fixed priority per ref: direct citation-key match, then whole-token
    // mention in still-unclaimed entries, then the unambiguous 1×1 positional
    // fallback. Each entry serves at most one ref, in requested order.
    const foundIndex =
      firstUnclaimed(byKey.get(ref.key), used) ??
      firstUnclaimed(byToken.get(ref.key), used) ??
      (refs.length === 1 && batchEntries.length === 1 && !used.has(0) ? 0 : undefined)
    if (foundIndex === undefined) return { ref: formattedRef }
    used.add(foundIndex)
    const entry = batchEntries[foundIndex]!
    const facts = parseExportItem(format, entry.text)
    return {
      ref: formattedRef,
      ...(facts.title !== undefined ? { title: facts.title } : {}),
      key: entry.key,
      start: entry.start,
      end: entry.end,
    }
  })
}

function locateRisFromBatch(text: string, refs: readonly ZoteroObjectRef[]): LocatedExportItem[] {
  const byId = new Map<string, BatchEntry>()
  for (const record of splitRisRecords(text)) {
    if (record.key !== undefined) byId.set(record.key, record)
  }
  return refs.map((ref) => {
    const formattedRef = formatRef(ref)
    const match = byId.get(ref.key)
    const facts = match !== undefined ? parseExportItem('ris', match.text) : undefined
    return {
      ref: formattedRef,
      ...(match?.key !== undefined ? { key: match.key } : {}),
      ...(facts?.title !== undefined ? { title: facts.title } : {}),
      ...(match !== undefined ? { start: match.start, end: match.end } : {}),
    }
  })
}

function locateCslFromBatch(text: string, refs: readonly ZoteroObjectRef[]): LocatedExportItem[] {
  let records: unknown
  try {
    records = JSON.parse(text)
  } catch {
    records = null
  }
  const list = Array.isArray(records) ? records : []
  const byId = new Map<string, { id: string; index: number; title?: string }>()
  const byKey = new Map<string, { id: string; index: number; title?: string }>()
  for (let i = 0; i < list.length; i++) {
    const rec = list[i]
    if (typeof rec === 'object' && rec !== null && !Array.isArray(rec)) {
      const r = rec as Record<string, unknown>
      if (typeof r.id === 'string') {
        const entry = {
          id: r.id,
          index: i,
          ...(typeof r.title === 'string' ? { title: r.title } : {}),
        }
        byId.set(r.id, entry)
        const slash = r.id.lastIndexOf('/')
        const key = slash !== -1 ? r.id.slice(slash + 1) : r.id
        if (!byKey.has(key)) {
          byKey.set(key, entry)
        }
      }
    }
  }
  const findMatch = (key: string) => byId.get(key) ?? byKey.get(key)
  return refs.map((ref) => {
    const formattedRef = formatRef(ref)
    const found = findMatch(ref.key)
    return {
      ref: formattedRef,
      ...(found?.title !== undefined ? { title: found.title } : {}),
      ...(found !== undefined ? { key: found.id, entryIndex: found.index } : {}),
    }
  })
}
