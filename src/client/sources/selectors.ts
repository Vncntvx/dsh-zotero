/**
 * Pure selectors over the source workspace: filters, the per-filter counts,
 * and the exports view model (per-format sections of deduplicated documents
 * over the successful artifacts). Filters narrow the stable union — they
 * never replace it, so clearing a filter restores every source. The "with
 * PDF" filter shares its single source of truth with the PDF badge and the
 * open-PDF action (`hasPdf`), and "issues" spans every non-running
 * irregularity, so what the bar names is what it shows.
 * @module dsh-zotero/client/sources/selectors
 */

import type { ExportArtifact, ExportDocumentItem, SourceItem } from './model.ts'
import { normalizeRefKey } from './provenance.ts'
import { hasPdf } from './source-capabilities.ts'

/** The sources filters; every filter is a subset of the stable union. */
export type SourceFilter = 'all' | 'pdf' | 'retrieved' | 'evidence' | 'exported' | 'issues'

/**
 * Whether one source carries an issue: a failed or stopped call, or a
 * provenance mismatch. A running call is in flight, not an issue.
 * @param item - the source to probe.
 * @returns true when the source belongs in the issues filter.
 */
export function hasIssue(item: SourceItem): boolean {
  return item.operations.failed > 0 || item.operations.stopped > 0 || item.provenance === 'mismatch'
}

export function filterSources(
  sources: readonly SourceItem[],
  filter: SourceFilter,
): readonly SourceItem[] {
  switch (filter) {
    case 'pdf':
      return sources.filter((item) => hasPdf(item))
    case 'retrieved':
      return sources.filter((item) => item.retrievalFacts !== undefined)
    case 'evidence':
      return sources.filter((item) => item.facts.evidenceCount > 0)
    case 'exported':
      return sources.filter((item) => item.facts.exportCount > 0)
    case 'issues':
      return sources.filter((item) => hasIssue(item))
    default:
      return sources
  }
}

/** The per-filter item counts the filter bar displays; a zero count disables its filter. */
export interface SourceFilterCounts {
  readonly all: number
  readonly pdf: number
  readonly retrieved: number
  readonly evidence: number
  readonly exported: number
  readonly issues: number
}

/**
 * Total passage count across the session: the actual kept passages, not the
 * number of sources that carry them. The sidebar's aggregate entry shows this
 * sum, while the "has passages" filter pill keeps the source count — the two
 * numbers mean different things and should not be conflated.
 */
export function evidencePassageTotalOf(sources: readonly SourceItem[]): number {
  return sources.reduce((total, item) => total + item.evidence.length, 0)
}

/** Count the sources matching each filter in one pass. */
export function filterCountsOf(sources: readonly SourceItem[]): SourceFilterCounts {
  let pdf = 0
  let retrieved = 0
  let evidence = 0
  let exported = 0
  let issues = 0
  for (const item of sources) {
    if (hasPdf(item)) pdf += 1
    if (item.retrievalFacts !== undefined) retrieved += 1
    if (item.facts.evidenceCount > 0) evidence += 1
    if (item.facts.exportCount > 0) exported += 1
    if (hasIssue(item)) issues += 1
  }
  return { all: sources.length, pdf, retrieved, evidence, exported, issues }
}

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
  readonly key?: string
  /** The item's title for display, when the entry carried one. */
  readonly title?: string
  /** The latest successful entry text of this document. */
  readonly text: string
  /** The export call ids that produced this document. */
  readonly callIds: readonly string[]
  /** The latest successful export's event time (Unix epoch ms); absent for legacy projections. */
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
   * Artifacts without per-document data: citation/bibliography exports and
   * legacy projections. They render as whole-text call rows.
   */
  readonly unresolved: readonly ExportArtifact[]
  /**
   * Items the provider could not locate in the merged body; the section
   * reports them as a light note with the artifact's full text still
   * downloadable, instead of failing the whole export.
   */
  readonly unresolvedItems: readonly UnresolvedItemGroup[]
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

/**
 * The entry text of one located item within the artifact's body. The
 * provider determined the location — a text span for the BibTeX family and
 * RIS, an array index for CSL JSON — so nothing is matched by guessing here.
 */
function entryTextOf(artifact: ExportArtifact, item: ExportDocumentItem): string | undefined {
  if (artifact.format === 'csljson') {
    if (item.entryIndex === undefined) return undefined
    try {
      const records: unknown = JSON.parse(artifact.text)
      const record = Array.isArray(records) ? records[item.entryIndex] : undefined
      if (typeof record !== 'object' || record === null) return undefined
      return JSON.stringify(record)
    } catch {
      return undefined
    }
  }
  if (item.start === undefined || item.end === undefined) return undefined
  return artifact.text.slice(item.start, item.end).trim()
}

/**
 * Resolve one artifact into per-document rows plus the items that could not
 * be located; undefined when the artifact carries no per-document data at
 * all (citation, bibliography, legacy projections), which keeps the whole
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
    artifact.items === undefined ||
    artifact.items.length === 0 ||
    !DOCUMENT_FORMATS.has(artifact.format)
  ) {
    return undefined
  }
  const documents: ExportedDocument[] = []
  const unresolved: ExportDocumentItem[] = []
  for (const item of artifact.items) {
    const text = entryTextOf(artifact, item)
    if (text === undefined) {
      unresolved.push(item)
      continue
    }
    documents.push({
      ref: item.ref,
      format: artifact.format,
      ...(item.key === undefined ? {} : { key: item.key }),
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
 * collapse into one document — the latest success is the current result,
 * the call history stays on the document — and exports without per-document
 * data (citation, bibliography, legacy projections) fall back to whole-text
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
          ...(document.key === undefined ? {} : { key: document.key }),
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

/**
 * The distinct exported documents across the session: the refs of every
 * successful artifact, deduplicated across formats and server provenance.
 * This is the exports count the lens tab shows — documents, not calls.
 * @param exports - the successful export artifacts in transcript order.
 * @returns the number of distinct exported refs.
 */
export function exportedRefCountOf(exports: readonly ExportArtifact[]): number {
  const refs = new Set<string>()
  for (const artifact of exports) {
    for (const ref of artifact.refs) refs.add(normalizeRefKey(ref))
  }
  return refs.size
}
