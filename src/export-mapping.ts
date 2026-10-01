/**
 * Server-side ref → batch-entry mapping for translator exports. The merged
 * body's entry order belongs to Zotero, and citation keys are generated in
 * the export context, so the browser never guesses again: the provider
 * parses entries directly from the batch export body in memory, locating
 * each requested item by deterministic multi-tier fingerprinting (DOI,
 * normalized title, first author & year disambiguation, extra citekeys),
 * item key, or identifier — strictly without positional guessing.
 * @module dsh-zotero/export-mapping
 */

import { bibtexFieldOf, parseExportItem } from './export-items.js'
import { asRecord, asString } from './json.js'
import { citekeyOf } from './normalize.js'
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

/** Normalize title for deterministic cross-format matching. */
export function normalizeTitleForAlignment(title: string | undefined): string | undefined {
  if (title === undefined) return undefined
  let text = title
  // Unwrap LaTeX formatting macros like \textbf{content} -> content before stripping braces
  let prev: string
  do {
    prev = text
    text = text.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
  } while (text !== prev)
  const stripped = text
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped === '' ? undefined : stripped
}

/** Normalize DOI for exact matching, stripping prefixes and query forms. */
export function normalizeDoiForAlignment(doi: string | undefined): string | undefined {
  if (doi === undefined) return undefined
  const stripped = doi
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
  return stripped === '' ? undefined : stripped
}

/** Normalize author name to primary surname for disambiguation. */
export function normalizeAuthorForAlignment(author: string | undefined): string | undefined {
  if (author === undefined) return undefined
  const firstAuthor = author.split(/\s+and\s+/i)[0]!
  // `split` on a non-empty string always yields at least one element, so
  // `pop()` here is always defined.
  const namePart = firstAuthor.includes(',')
    ? firstAuthor.split(',')[0]!
    : firstAuthor.split(/\s+/).pop()!
  const stripped = namePart
    .replace(/[{}]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim()
  return stripped === '' ? undefined : stripped
}

/** Normalize date or year field to a 4-digit year string. */
export function normalizeYearForAlignment(dateOrYear: string | undefined): string | undefined {
  if (dateOrYear === undefined) return undefined
  const match = /\b(\d{4})\b/.exec(dateOrYear)
  return match?.[1]
}

interface RefFingerprint {
  readonly ref: ZoteroObjectRef
  readonly formattedRef: string
  readonly key: string
  readonly titleClean?: string
  readonly doiClean?: string
  readonly yearClean?: string
  readonly authorClean?: string
  readonly extraCiteKey?: string
}

interface EntryFingerprint {
  readonly index: number
  readonly entry: BatchEntry
  readonly citeKey?: string
  readonly title?: string
  readonly titleClean?: string
  readonly doiClean?: string
  readonly yearClean?: string
  readonly authorClean?: string
  /** Alphanumeric tokens of the entry text, for the whole-token mention tier. */
  readonly tokens: ReadonlySet<string>
}

/**
 * Deterministically align BibTeX/BibLaTeX entries against requested refs
 * using multi-tier ground-truth fingerprints (extra citekeys, DOI, cleaned
 * title, first author & year). Positional guessing is strictly forbidden.
 */
export function alignBibtexEntries(
  text: string,
  refs: readonly ZoteroObjectRef[],
  rawItems?: readonly unknown[],
): LocatedExportItem[] {
  const batchEntries = splitBibtexEntries(text)
  const rawItemsByKey = new Map<string, Record<string, unknown>>()
  for (const item of rawItems ?? []) {
    const asRec = asRecord(item)
    if (asRec === undefined) continue
    const data = asRecord(asRec['data'])
    const key = asString(asRec['key']) ?? asString(data?.['key'])
    if (key !== undefined) {
      rawItemsByKey.set(key, asRec)
    }
  }

  const refFingerprints: RefFingerprint[] = refs.map((ref) => {
    const raw = rawItemsByKey.get(ref.key)
    const data = asRecord(raw?.['data']) ?? raw
    const title = asString(data?.['title'])
    const doi = asString(data?.['DOI'])
    const date = asString(data?.['date'])
    const extra = asString(data?.['extra'])
    const creators = Array.isArray(data?.['creators']) ? data!['creators'] : []
    const firstCreator = asRecord(creators[0])
    const authorName = asString(firstCreator?.['lastName'] ?? firstCreator?.['name'])
    return {
      ref,
      formattedRef: formatRef(ref),
      key: ref.key,
      titleClean: normalizeTitleForAlignment(title),
      doiClean: normalizeDoiForAlignment(doi),
      yearClean: normalizeYearForAlignment(date),
      authorClean: normalizeAuthorForAlignment(authorName),
      extraCiteKey: citekeyOf(extra),
    }
  })

  const entryFingerprints: EntryFingerprint[] = batchEntries.map((entry, index) => {
    const title = bibtexFieldOf(entry.text, 'title')
    const doi = bibtexFieldOf(entry.text, 'doi')
    const date = bibtexFieldOf(entry.text, 'year') ?? bibtexFieldOf(entry.text, 'date')
    const author = bibtexFieldOf(entry.text, 'author')
    return {
      index,
      entry,
      citeKey: entry.key,
      title,
      titleClean: normalizeTitleForAlignment(title),
      doiClean: normalizeDoiForAlignment(doi),
      yearClean: normalizeYearForAlignment(date),
      authorClean: normalizeAuthorForAlignment(author),
      // Whole-token mention lookup: ref keys are `[A-Z0-9]{8}` by the ref
      // grammar (ref-grammar.ts REF_KEY_SOURCE), so a token-set probe is
      // exactly the `\b<key>\b` test — underscores remain word characters,
      // just as they do for `\b` — and no regex built per pair.
      tokens: new Set(entry.text.split(/[^A-Za-z0-9_]+/)),
    }
  })

  const matchedRefToEntry = new Map<number, number>()
  const claimedEntries = new Set<number>()

  const claimUniqueMatch = (
    predicate: (r: RefFingerprint, e: EntryFingerprint) => boolean,
    onMultiple?: (
      candidates: EntryFingerprint[],
      r: RefFingerprint,
    ) => EntryFingerprint | undefined,
  ): void => {
    for (let rIdx = 0; rIdx < refFingerprints.length; rIdx++) {
      if (matchedRefToEntry.has(rIdx)) continue
      const r = refFingerprints[rIdx]!
      const candidates = entryFingerprints.filter(
        (e) => !claimedEntries.has(e.index) && predicate(r, e),
      )
      let match: EntryFingerprint | undefined
      if (candidates.length === 1) {
        match = candidates[0]!
      } else if (candidates.length > 1 && onMultiple !== undefined) {
        match = onMultiple(candidates, r)
      }
      if (match !== undefined) {
        matchedRefToEntry.set(rIdx, match.index)
        claimedEntries.add(match.index)
      }
    }
  }

  // Tier 1: Extra citeKey exact match
  claimUniqueMatch((r, e) => r.extraCiteKey !== undefined && e.citeKey === r.extraCiteKey)

  // Tier 2: DOI exact unique match
  claimUniqueMatch((r, e) => r.doiClean !== undefined && e.doiClean === r.doiClean)

  // Tier 3 & 4: Normalized title unique match, disambiguated by year and author
  claimUniqueMatch(
    (r, e) => r.titleClean !== undefined && e.titleClean === r.titleClean,
    (candidates, r) => {
      const refined = candidates.filter((c) => {
        const yearOk = r.yearClean === undefined || c.yearClean === r.yearClean
        const authorOk = r.authorClean === undefined || c.authorClean === r.authorClean
        return yearOk && authorOk
      })
      return refined.length === 1 ? refined[0] : undefined
    },
  )

  // Tier 5: Direct citeKey equals ref.key (for mock servers or custom citekey configs)
  claimUniqueMatch((r, e) => e.citeKey === r.key)

  // Tier 6: Whole-token mention inside entry body (e.g. note or URL contains the 8-char itemKey)
  claimUniqueMatch((r, e) => e.tokens.has(r.key))

  // Final assembly: NEVER use positional guessing. Unmatched refs stay unlocated.
  return refFingerprints.map((r, rIdx) => {
    const entryIdx = matchedRefToEntry.get(rIdx)
    if (entryIdx === undefined) {
      return { ref: r.formattedRef }
    }
    const entryFp = entryFingerprints[entryIdx]!
    return {
      ref: r.formattedRef,
      ...(entryFp.title !== undefined ? { title: entryFp.title } : {}),
      key: entryFp.entry.key,
      start: entryFp.entry.start,
      end: entryFp.entry.end,
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
    const rec = asRecord(list[i])
    if (rec === undefined) continue
    const id = asString(rec['id'])
    if (id !== undefined) {
      const title = asString(rec['title'])
      const entry = {
        id,
        index: i,
        ...(title !== undefined ? { title } : {}),
      }
      byId.set(id, entry)
      const slash = id.lastIndexOf('/')
      const key = slash !== -1 ? id.slice(slash + 1) : id
      if (!byKey.has(key)) {
        byKey.set(key, entry)
      }
    }
  }

  return refs.map((ref) => {
    const formattedRef = formatRef(ref)
    const found = byId.get(ref.key) ?? byKey.get(ref.key)
    return {
      ref: formattedRef,
      ...(found?.title !== undefined ? { title: found.title } : {}),
      ...(found !== undefined ? { key: found.id, entryIndex: found.index } : {}),
    }
  })
}

/**
 * Locate items directly from the batch export body in memory without
 * secondary per-document HTTP calls.
 */
export function locateExportItemsFromBatch(
  format: ZoteroExportFormat,
  text: string,
  refs: readonly ZoteroObjectRef[],
  rawItems?: readonly unknown[],
): LocatedExportItem[] {
  if (format === 'bibtex' || format === 'biblatex') {
    return alignBibtexEntries(text, refs, rawItems)
  }
  if (format === 'ris') return locateRisFromBatch(text, refs)
  if (format === 'csljson') return locateCslFromBatch(text, refs)
  return refs.map((ref) => ({ ref: formatRef(ref) }))
}
