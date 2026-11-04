/**
 * Types and canonical interfaces for the scholarly literature subsystem.
 * @module dsh-zotero/scholarly/types
 */

import { SCHOLARLY_SAVE_TOOL_NAME } from '../constants.js'

/**
 * The component's seven model tools, in registration order (the factory's
 * order in `src/scholarly/tools/index.ts`).
 *
 * One list for the component's own policy text and for the test helper. The
 * six retrieval tools declare their own `name:` in their definition files,
 * exactly as the local component's tools do beside `src/constants.ts`; the
 * composition test ties the two lists together by comparing this constant with
 * the tools the registry actually holds. The write entry is shared with
 * `src/constants.ts`: the registration and the core write-surface policy both
 * use that constant, so a rename cannot leave them disagreeing.
 */
export const SCHOLARLY_TOOL_NAMES = [
  'scholarly_search',
  'scholarly_get',
  'scholarly_citations',
  'scholarly_read',
  'scholarly_cite',
  'scholarly_verify',
  SCHOLARLY_SAVE_TOOL_NAME,
] as const

export type ScholarlyToolName = (typeof SCHOLARLY_TOOL_NAMES)[number]

export const SCHOLARLY_SOURCE_IDS = [
  'arxiv',
  'openalex',
  'crossref',
  'semanticscholar',
  'pubmed',
  'europepmc',
  'dblp',
] as const

export type ScholarlySourceId = (typeof SCHOLARLY_SOURCE_IDS)[number]

export const SCHOLARLY_SOURCE_NAMES: Record<ScholarlySourceId, string> = {
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  semanticscholar: 'Semantic Scholar',
  pubmed: 'PubMed',
  europepmc: 'Europe PMC',
  dblp: 'DBLP',
}

export interface InLibraryInfo {
  itemKey: string
  libraryId: string
  collections: string[]
}

export interface ScholarlyPaper {
  title: string
  authors: string[]
  year?: number
  /** ISO date string if known by the index. */
  date?: string
  venue?: string
  abstract?: string
  /** One-sentence summary from Semantic Scholar. */
  tldr?: string
  type?: string
  doi?: string
  arxiv?: string
  pmid?: string
  pmcid?: string
  openalex?: string
  s2?: string
  url?: string
  /** Lawful open-access copy URL. */
  pdfUrl?: string
  citations?: number
  openAccess?: boolean
  retracted?: boolean
  sources: string[]
  inLibrary?: InLibraryInfo
}

export interface ScholarlyQuery {
  query: string
  sources?: ScholarlySourceId[]
  limit: number
  yearFrom?: number
  yearTo?: number
  openAccess?: boolean
  sort: 'relevance' | 'date' | 'citations'
  /** arXiv categories (e.g. cs.LG, cs.CL, stat.ML). */
  categories?: string[]
}

export interface ScholarlyKeys {
  email?: string
  s2Key?: string
  openalexKey?: string
  ncbiKey?: string
}
