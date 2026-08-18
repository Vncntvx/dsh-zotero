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

const ENTRY_START = /@[A-Za-z]+\{([^,\s{}]+),/g
const RIS_RECORD_END = /^ER  -[ ]?$/gm
const RIS_ID = /^ID  - (.+)$/m

/** Strip an entry's citation key so batch and single-item bodies compare by content. */
function normalizeBibtexEntry(text: string): string {
  return text.trim().replace(/^@[A-Za-z]+\{[^,\s{}]+,/, '@{,')
}

/**
 * Split a BibTeX/BibLaTeX body into its entries with their text spans. Each
 * entry runs from its `@type{key,` start to the next entry's start.
 * @param text - the export body (offsets are relative to this string).
 * @returns the entries in body order.
 */
export function splitBibtexEntries(text: string): BatchEntry[] {
  const starts: { readonly key: string; readonly index: number }[] = []
  for (const match of text.matchAll(ENTRY_START)) {
    starts.push({ key: match[1]!, index: match.index })
  }
  const entries: BatchEntry[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!
    const end = starts[index + 1]?.index ?? text.length
    entries.push({
      key: start.key,
      start: start.index,
      end,
      text: text.slice(start.index, end).trim(),
    })
  }
  return entries
}

/**
 * Split an RIS body into its records with their text spans. Each record
 * runs from the previous terminator to its `ER` line.
 * @param text - the export body (offsets are relative to this string).
 * @returns the records in body order.
 */
export function splitRisRecords(text: string): BatchEntry[] {
  const records: BatchEntry[] = []
  let recordStart = 0
  for (const match of text.matchAll(RIS_RECORD_END)) {
    const start = recordStart
    const record = text.slice(start, match.index)
    recordStart = match.index + match[0].length
    const id = RIS_ID.exec(record)?.[1]?.trim()
    records.push({
      ...(id === undefined || id === '' ? {} : { key: id }),
      start,
      end: match.index,
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
