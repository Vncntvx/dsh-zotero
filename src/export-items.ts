/**
 * Per-document facts of a translator-format export, parsed from the
 * single-item export response Zotero returns for one ref. Parsing one entry
 * is trivial and deterministic — the merged batch body's entry order belongs
 * to Zotero, so refs are never indexed against it; the provider requests
 * each document on its own and pairs the refs itself.
 * @module dsh-zotero/export-items
 */

import type { ZoteroExportFormat } from './types.js'

/** The parsed per-document facts of one single-item export. */
export interface ExportItemFacts {
  /**
   * The format-local identifier: the BibTeX/BibLaTeX citation key or the
   * CSL JSON id; absent when the format has none (RIS) or it cannot be
   * parsed.
   */
  readonly key?: string
  /** The item's title for display, when the entry carries one. */
  readonly title?: string
}

const BIBTEX_KEY = /@[A-Za-z]+\{([^,\s{}]+),/
const BIBTEX_TITLE = /\btitle\s*=\s*\{([^}]*)\}/i
const RIS_TITLE = /^TI  - (.+)$/m

/** The BibTeX/BibLaTeX facts: the citation key plus the first title field. */
function bibtexFactsOf(text: string): ExportItemFacts {
  const key = BIBTEX_KEY.exec(text)?.[1]
  const title = BIBTEX_TITLE.exec(text)?.[1]
  return {
    ...(key === undefined ? {} : { key }),
    ...(title === undefined ? {} : { title }),
  }
}

/** The RIS facts: records carry no citation key, only the title line. */
function risFactsOf(text: string): ExportItemFacts {
  const title = RIS_TITLE.exec(text)?.[1]
  return title === undefined ? {} : { title }
}

/** The CSL JSON facts: the export is an array of one record, `id`/`title`. */
function csljsonFactsOf(text: string): ExportItemFacts {
  let records: unknown
  try {
    records = JSON.parse(text)
  } catch {
    return {}
  }
  if (!Array.isArray(records) || records.length === 0) return {}
  const record = records[0] as Record<string, unknown>
  const key = typeof record['id'] === 'string' ? record['id'] : undefined
  const title = typeof record['title'] === 'string' ? record['title'] : undefined
  return {
    ...(key === undefined ? {} : { key }),
    ...(title === undefined ? {} : { title }),
  }
}

/**
 * Parse the per-document facts of one single-item translator export.
 * @param format - the requested translator format.
 * @param text - the single-item export response body.
 * @returns the parsed key/title facts; empty when the format is unsupported
 *   or the entry carries no usable facts.
 */
export function parseExportItem(format: ZoteroExportFormat, text: string): ExportItemFacts {
  if (format === 'bibtex' || format === 'biblatex') return bibtexFactsOf(text)
  if (format === 'ris') return risFactsOf(text)
  if (format === 'csljson') return csljsonFactsOf(text)
  return {}
}
