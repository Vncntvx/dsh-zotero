/**
 * Server-side ref → batch-entry mapping for translator exports. The merged
 * body's entry order belongs to Zotero, and citation keys are generated in
 * the export context, so the browser never guesses again: the provider
 * splits the batch body once, matches each single-item export to its batch
 * entry — for BibTeX/BibLaTeX by content with the citation key stripped
 * (the same item exports identically in both contexts) — and projects the
 * located entry's real key and text span. RIS records identify themselves
 * by the item key and CSL JSON records by their id, so those formats match
 * on identity instead.
 * @module dsh-zotero/export-mapping
 */

import { parseExportItem } from './export-items.js'
import type { ZoteroExportFormat } from './types.js'

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

/** One per-item export the mapper pairs with the batch body. */
export interface ExportItemInput {
  /** The formatted `zotero://` ref of the item. */
  readonly ref: string
  /** The item's object key, which RIS records carry as their id. */
  readonly key: string
  /** The single-item export body. */
  readonly text: string
}

/** The start of one entry: `@type{` in letters, anywhere in the body. */
const ENTRY_START = /@[A-Za-z]+\{/g
const RIS_RECORD_END = /^ER  -[ ]?$/gm
const RIS_ID = /^ID  - (.+)$/m

/** Strip an entry's citation key so batch and single-item bodies compare by content. */
function normalizeBibtexEntry(text: string): string {
  return text.trim().replace(/^@[A-Za-z]+\{[^,\s{}]+,/, '@{,')
}

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
 * entry runs from its `@type{` start to the next entry's start. The scan is
 * progressive and brace-aware: every entry's body is skipped to its closing
 * brace before the next start is searched, so an `@type{key,` shape inside a
 * field value, a quoted string, or a comment never starts a new entry.
 * @param text - the export body (offsets are relative to this string).
 * @returns the entries in body order.
 */
export function splitBibtexEntries(text: string): BatchEntry[] {
  const starts: { readonly key?: string; readonly index: number }[] = []
  let cursor = 0
  for (;;) {
    ENTRY_START.lastIndex = cursor
    const start = ENTRY_START.exec(text)
    if (start === null) break
    const key = entryKeyOf(text, start.index + start[0].length)
    starts.push({ ...(key === undefined ? {} : { key }), index: start.index })
    const end = entryEndOf(text, start.index + start[0].length)
    cursor = Math.max(end, start.index + start[0].length)
    if (end >= text.length) break
  }
  const entries: BatchEntry[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!
    const end = starts[index + 1]?.index ?? text.length
    entries.push({
      ...(start.key === undefined ? {} : { key: start.key }),
      start: start.index,
      end,
      text: text.slice(start.index, end).trim(),
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
 * Pair each single-item export with its entry in the batch body. The batch
 * body's own key wins for BibTeX/BibLaTeX (batch-context citation keys may
 * differ from single-item ones); a per-item body that matches no batch
 * entry yields an item without a location, which the UI reports individually
 * instead of failing the whole export.
 * @param format - the translator format of the batch body.
 * @param text - the trimmed batch body, exactly as the browser will hold it.
 * @param entries - the per-item exports, in the requested ref order.
 * @returns the located items, one per input entry.
 */
export function locateExportItems(
  format: ZoteroExportFormat,
  text: string,
  entries: readonly ExportItemInput[],
): LocatedExportItem[] {
  if (format === 'bibtex' || format === 'biblatex') {
    const batchEntries = splitBibtexEntries(text)
    return entries.map(({ ref, text: itemText }) => {
      const facts = parseExportItem(format, itemText)
      const normalized = normalizeBibtexEntry(itemText)
      const match = batchEntries.find((entry) => normalizeBibtexEntry(entry.text) === normalized)
      return {
        ref,
        ...(facts.title === undefined ? {} : { title: facts.title }),
        ...(match === undefined ? {} : { key: match.key, start: match.start, end: match.end }),
      }
    })
  }
  if (format === 'ris') {
    const byId = new Map<string, BatchEntry>()
    for (const record of splitRisRecords(text)) {
      if (record.key !== undefined) byId.set(record.key, record)
    }
    return entries.map(({ ref, key, text: itemText }) => {
      const facts = parseExportItem(format, itemText)
      const match = byId.get(key)
      return {
        ref,
        ...(facts.title === undefined ? {} : { title: facts.title }),
        ...(match === undefined ? {} : { start: match.start, end: match.end }),
      }
    })
  }
  if (format === 'csljson') {
    let records: unknown
    try {
      records = JSON.parse(text)
    } catch {
      records = null
    }
    const list = Array.isArray(records) ? records : []
    return entries.map(({ ref, text: itemText }) => {
      const facts = parseExportItem(format, itemText)
      const index =
        facts.key === undefined
          ? -1
          : list.findIndex(
              (record) =>
                typeof record === 'object' &&
                record !== null &&
                (record as Record<string, unknown>)['id'] === facts.key,
            )
      return {
        ref,
        ...(facts.title === undefined ? {} : { title: facts.title }),
        ...(index === -1 ? {} : { key: facts.key, entryIndex: index }),
      }
    })
  }
  return entries.map(({ ref }) => ({ ref }))
}
