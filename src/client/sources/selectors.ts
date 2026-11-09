/**
 * Pure selectors over the source workspace: the exports view model
 * (per-format sections of deduplicated documents over the successful
 * artifacts) plus the filter vocabulary shared with the host's aggregates.
 * The filter predicates and the per-filter counts live under `src/sources/`
 * so the host's workspace totals judge a source with exactly the predicates
 * the browser renders by; the workspace carries those totals, so nothing
 * here recounts a filtered union.
 * @module dsh-zotero/client/sources/selectors
 */

import { normalizeRefKey } from '../../sources/evidence-match.js'
import type { ExportArtifact, ExportDocumentItem } from '../../sources/model.js'

export {
  filterCountsOf,
  filterSources,
  hasIssue,
  type SourceFilter,
  type SourceFilterCounts,
} from '../../sources/filters.js'

/**
 * One exported document, deduped across the calls that produced it. The
 * content (entry text, key, title) is the latest successful export's; the
 * call history accumulates in `callIds`.
 */
export interface ExportedDocument {
  /** The exported item's ref. */
  readonly ref: string
  readonly format: string
  /**
   * The format-local identifier: the BibTeX/BibLaTeX citation key or the
   * CSL JSON id; absent when the format has none (RIS).
   */
  readonly exportKey?: string
  readonly citationKey?: string
  readonly citationKeySource?: 'native' | 'extra'
  readonly citationKeyConflict?: { readonly native: string; readonly extra: string }
  /** The item's title for display, when the entry carried one. */
  readonly title?: string
  /** The latest successful entry text of this document. */
  readonly text: string
  /** The export call ids that produced this document. */
  readonly callIds: readonly string[]
  /** The latest successful export's event time (Unix epoch ms). */
  readonly latestExportedAt?: number
}

/** The items of one artifact that could not be located in the merged body. */
interface UnresolvedItemGroup {
  /** The artifact whose full text remains downloadable. */
  readonly artifact: ExportArtifact
  /** The number of items that could not be shown individually. */
  readonly count: number
}

/** One format section of the exports page: documents plus the calls that could not be itemized. */
export interface ExportSection {
  readonly format: string
  readonly documents: readonly ExportedDocument[]
  /**
   * Artifacts without per-document data: citation/bibliography exports.
   * They render as whole-text call rows.
   */
  readonly unresolved: readonly ExportArtifact[]
  /**
   * Items the provider could not locate in the merged body; the section
   * reports them as a light note with the artifact's full text still
   * downloadable, instead of failing the whole export.
   */
  readonly unresolvedItems: readonly UnresolvedItemGroup[]
}

/**
 * Keep only export content that can be attributed to one source. Batch bodies
 * are narrowed with Zotero's recorded item boundaries; if a boundary is
 * missing or invalid, the body is omitted rather than exposing other sources.
 */
export function sourceExportsOf(
  exports: readonly ExportArtifact[],
  ref: string,
): readonly ExportArtifact[] {
  const key = normalizeRefKey(ref)
  const sourceExports: ExportArtifact[] = []
  for (const artifact of exports) {
    if (!artifact.refs.some((candidate) => normalizeRefKey(candidate) === key)) continue
    const uniqueRefs = new Set(artifact.refs.map(normalizeRefKey))
    if (uniqueRefs.size === 1) {
      if (artifact.text.trim() !== '') sourceExports.push(artifact)
      continue
    }
    if (artifact.items === undefined || artifact.items.length === 0) continue
    const matches = artifact.items.filter((item) => normalizeRefKey(item.ref) === key)
    if (matches.length !== 1) continue
    const item = matches[0]!
    let text: string
    let isolatedItem: ExportDocumentItem
    if (artifact.format === 'csljson') {
      const records = parseCslRecords(artifact)
      const record = item.entryIndex === undefined ? undefined : records?.[item.entryIndex]
      if (typeof record !== 'object' || record === null) continue
      text = JSON.stringify([record])
      isolatedItem = { ...item, entryIndex: 0 }
    } else {
      if (
        item.start === undefined ||
        item.end === undefined ||
        item.start < 0 ||
        item.end <= item.start ||
        item.end > artifact.text.length
      ) {
        continue
      }
      text = artifact.text.slice(item.start, item.end).trim()
      if (text === '') continue
      isolatedItem = { ...item, start: 0, end: text.length }
    }
    sourceExports.push({
      ...artifact,
      refs: [ref],
      refsOmitted: 0,
      items: [isolatedItem],
      text,
    })
  }
  return sourceExports
}

/** The mutable build shape of one export section. */
interface ExportSectionDraft {
  readonly format: string
  readonly documents: ExportedDocument[]
  readonly unresolved: ExportArtifact[]
  readonly unresolvedItems: UnresolvedItemGroup[]
}

/** The translator formats whose bodies itemize into per-document entries. */
const DOCUMENT_FORMATS = new Set(['bibtex', 'biblatex', 'ris', 'csljson'])

function parseCslRecords(artifact: ExportArtifact): readonly unknown[] | undefined {
  if (artifact.format !== 'csljson') return undefined
  try {
    const records: unknown = JSON.parse(artifact.text)
    return Array.isArray(records) ? records : undefined
  } catch {
    return undefined
  }
}

/**
 * The entry text of one located item within the artifact's body. The
 * provider determined the location (a text span for the BibTeX family and
 * RIS, an array index for CSL JSON), so nothing is matched by guessing here.
 */
function entryTextOf(
  artifact: ExportArtifact,
  item: ExportDocumentItem,
  cslRecords?: readonly unknown[],
): string | undefined {
  if (artifact.format === 'csljson') {
    if (item.entryIndex === undefined || cslRecords === undefined) return undefined
    const record = cslRecords[item.entryIndex]
    if (typeof record !== 'object' || record === null) return undefined
    return JSON.stringify(record)
  }
  if (item.start === undefined || item.end === undefined) return undefined
  return artifact.text.slice(item.start, item.end).trim()
}

/**
 * Resolve one artifact into per-document rows plus the items that could not
 * be located; undefined when the artifact carries no per-document data at
 * all (citation, bibliography), which keeps the whole
 * artifact on the call-row fallback. Partial resolution is the rule: one
 * unlocatable item never hides the other documents of the same export.
 */
function documentsOf(artifact: ExportArtifact):
  | {
      readonly documents: readonly ExportedDocument[]
      readonly unresolved: readonly ExportDocumentItem[]
    }
  | undefined {
  if (
    artifact.resultFile !== undefined ||
    artifact.items === undefined ||
    artifact.items.length === 0 ||
    !DOCUMENT_FORMATS.has(artifact.format)
  ) {
    return undefined
  }
  const cslRecords = parseCslRecords(artifact)
  const documents: ExportedDocument[] = []
  const unresolved: ExportDocumentItem[] = []
  for (const item of artifact.items) {
    const text = entryTextOf(artifact, item, cslRecords)
    if (text === undefined) {
      unresolved.push(item)
      continue
    }
    documents.push({
      ref: item.ref,
      format: artifact.format,
      ...(item.exportKey === undefined ? {} : { exportKey: item.exportKey }),
      ...(item.citationKey === undefined ? {} : { citationKey: item.citationKey }),
      ...(item.citationKeySource === undefined
        ? {}
        : { citationKeySource: item.citationKeySource }),
      ...(item.citationKeyConflict === undefined
        ? {}
        : { citationKeyConflict: item.citationKeyConflict }),
      ...(item.title === undefined ? {} : { title: item.title }),
      text,
      callIds: [artifact.callId],
      ...(artifact.settledAt === undefined ? {} : { latestExportedAt: artifact.settledAt }),
    })
  }
  return { documents, unresolved }
}

/**
 * The exports page's view model: per-format sections over the artifacts, in
 * first-seen format order. Repeated exports of the same (format, ref)
 * collapse into one document, where the latest success is the current result
 * and the call history stays on the document; exports without per-document
 * data (citation, bibliography) fall back to whole-text
 * artifact rows, while entries the provider could not locate are reported
 * individually.
 * @param exports - the successful export artifacts in transcript order.
 * @returns the format sections in first-seen order.
 */
export function exportSectionsOf(exports: readonly ExportArtifact[]): readonly ExportSection[] {
  const sections: ExportSectionDraft[] = []
  const sectionByFormat = new Map<string, ExportSectionDraft>()
  const documentByKey = new Map<string, ExportedDocument>()
  for (const artifact of exports) {
    let section = sectionByFormat.get(artifact.format)
    if (section === undefined) {
      section = { format: artifact.format, documents: [], unresolved: [], unresolvedItems: [] }
      sectionByFormat.set(artifact.format, section)
      sections.push(section)
    }
    const resolved = documentsOf(artifact)
    if (resolved === undefined) {
      section.unresolved.push(artifact)
      continue
    }
    for (const document of resolved.documents) {
      const key = `${document.format}|${document.ref}`
      const existing = documentByKey.get(key)
      if (existing === undefined) {
        documentByKey.set(key, document)
        section.documents.push(document)
      } else {
        const merged: ExportedDocument = {
          ...existing,
          ...(document.title === undefined ? {} : { title: document.title }),
          ...(document.exportKey === undefined ? {} : { exportKey: document.exportKey }),
          ...(document.citationKey === undefined ? {} : { citationKey: document.citationKey }),
          ...(document.citationKeySource === undefined
            ? {}
            : { citationKeySource: document.citationKeySource }),
          ...(document.citationKeyConflict === undefined
            ? {}
            : { citationKeyConflict: document.citationKeyConflict }),
          text: document.text,
          callIds: [...existing.callIds, ...document.callIds],
          ...(document.latestExportedAt === undefined
            ? {}
            : { latestExportedAt: document.latestExportedAt }),
        }
        documentByKey.set(key, merged)
        section.documents[section.documents.indexOf(existing)] = merged
      }
    }
    if (resolved.unresolved.length > 0) {
      section.unresolvedItems.push({ artifact, count: resolved.unresolved.length })
    }
  }
  return sections
}
