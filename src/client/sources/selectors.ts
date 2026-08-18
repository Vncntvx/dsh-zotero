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

import { shortKeyOf } from '../presenters.ts'
import { bibtexEntriesOf, csljsonEntriesOf, risEntriesOf } from './export-entries.ts'
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

/** One format section of the exports page: documents plus the calls that could not be itemized. */
export interface ExportSection {
  readonly format: string
  readonly documents: readonly ExportedDocument[]
  /**
   * Artifacts without per-document data: citation/bibliography exports,
   * legacy projections, or translator exports whose entries could not be
   * located in the merged body. They render as whole-text call rows.
   */
  readonly unresolved: readonly ExportArtifact[]
}

/** The mutable build shape of one export section. */
interface ExportSectionDraft {
  readonly format: string
  readonly documents: ExportedDocument[]
  readonly unresolved: ExportArtifact[]
}

/** The translator formats whose bodies chunk into per-document entries. */
const DOCUMENT_FORMATS = new Set(['bibtex', 'biblatex', 'ris', 'csljson'])

/** Locate one artifact's entries in its merged body, keyed by the join key. */
function entriesOf(artifact: ExportArtifact): Map<string, string> {
  if (artifact.format === 'ris') return risEntriesOf(artifact.text)
  if (artifact.format === 'csljson') return csljsonEntriesOf(artifact.text)
  return bibtexEntriesOf(artifact.text)
}

/**
 * The join key that locates one item's entry in the merged body: the
 * citation-style key for BibTeX/BibLaTeX/CSL JSON, the item key (which RIS
 * records carry as their id) for RIS.
 */
function joinKeyOf(format: string, item: ExportDocumentItem): string | undefined {
  if (format === 'ris') {
    const key = shortKeyOf(item.ref)
    return key === null ? undefined : key
  }
  return item.key
}

/**
 * Resolve one artifact into per-document rows; undefined when any item's
 * entry cannot be located in the merged body. An artifact resolves wholly
 * or not at all, so its facts never split across two render modes.
 */
function documentsOf(artifact: ExportArtifact): readonly ExportedDocument[] | undefined {
  if (
    artifact.items === undefined ||
    artifact.items.length === 0 ||
    !DOCUMENT_FORMATS.has(artifact.format)
  ) {
    return undefined
  }
  const entries = entriesOf(artifact)
  const documents: ExportedDocument[] = []
  for (const item of artifact.items) {
    const joinKey = joinKeyOf(artifact.format, item)
    const text = joinKey === undefined ? undefined : entries.get(joinKey)
    if (text === undefined) return undefined
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
  return documents
}

/**
 * The exports page's view model: per-format sections over the artifacts, in
 * first-seen format order. Repeated exports of the same (format, ref)
 * collapse into one document — the latest success is the current result,
 * the call history stays on the document — and exports without per-document
 * data (citation, bibliography, legacy projections, unlocatable entries)
 * fall back to whole-text artifact rows.
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
      section = { format: artifact.format, documents: [], unresolved: [] }
      sectionByFormat.set(artifact.format, section)
      sections.push(section)
    }
    const documents = documentsOf(artifact)
    if (documents === undefined) {
      section.unresolved.push(artifact)
      continue
    }
    for (const document of documents) {
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
