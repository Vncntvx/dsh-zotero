/**
 * Deterministic entry chunking of a translator-format export body. The
 * merged body's entry order belongs to Zotero, so the UI never indexes it
 * against the requested refs; instead each chunk is located by the
 * format-local identifier the tool parsed from one-entry-at-a-time exports,
 * and runs from its own entry start to the next entry's start.
 * @module dsh-zotero/client/sources/export-entries
 */

/** A BibTeX/BibLaTeX entry start: `@type{key,` at any position. */
const ENTRY_START = /@[A-Za-z]+\{([^,\s{}]+),/g
/** An RIS record terminator line (`ER` followed by the standard two spaces and a dash). */
const RIS_RECORD_END = /^ER  -[ ]?$/gm
/** An RIS record's id line, which Zotero fills with the item key. */
const RIS_ID = /^ID  - (.+)$/m

/**
 * Chunk a BibTeX/BibLaTeX body by its entries' citation keys. Each chunk
 * starts at its entry's `@type{key,` and ends where the next entry starts.
 * @param text - the merged export body.
 * @returns the entry chunks keyed by citation key; empty when the body has
 *   no parseable entries.
 */
export function bibtexEntriesOf(text: string): Map<string, string> {
  const starts: { readonly key: string; readonly index: number }[] = []
  for (const match of text.matchAll(ENTRY_START)) {
    starts.push({ key: match[1]!, index: match.index })
  }
  const chunks = new Map<string, string>()
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!
    const end = starts[index + 1]?.index ?? text.length
    // A duplicated key keeps its first entry, like the key extractor.
    if (!chunks.has(start.key)) chunks.set(start.key, text.slice(start.index, end).trim())
  }
  return chunks
}

/**
 * Chunk an RIS body by its `ER` records. Each record is keyed by its `ID`
 * line — Zotero fills it with the item key, so it pairs with the refs
 * without relying on record order.
 * @param text - the merged export body.
 * @returns the record chunks keyed by record id; empty when the body has
 *   no records with an id.
 */
export function risEntriesOf(text: string): Map<string, string> {
  const chunks = new Map<string, string>()
  let recordStart = 0
  for (const match of text.matchAll(RIS_RECORD_END)) {
    const record = text.slice(recordStart, match.index).trim()
    recordStart = match.index + match[0].length
    const key = RIS_ID.exec(record)?.[1]?.trim()
    if (key !== undefined && key !== '') chunks.set(key, record)
  }
  const tail = text.slice(recordStart).trim()
  if (tail !== '') {
    const key = RIS_ID.exec(tail)?.[1]?.trim()
    if (key !== undefined && key !== '') chunks.set(key, tail)
  }
  return chunks
}

/**
 * Chunk a CSL JSON body into its records. Each record is keyed by its `id`
 * field — the same value the per-item exports parsed, so the records pair
 * with the items regardless of array order.
 * @param text - the merged export body.
 * @returns the record chunks (each re-serialized) keyed by record id; empty
 *   when the body is not a JSON array or no record carries a string id.
 */
export function csljsonEntriesOf(text: string): Map<string, string> {
  let records: unknown
  try {
    records = JSON.parse(text)
  } catch {
    return new Map()
  }
  if (!Array.isArray(records)) return new Map()
  const chunks = new Map<string, string>()
  for (const record of records) {
    if (typeof record !== 'object' || record === null) continue
    const id = (record as Record<string, unknown>)['id']
    if (typeof id !== 'string' || id === '') continue
    chunks.set(id, JSON.stringify(record))
  }
  return chunks
}
