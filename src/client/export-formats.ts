/**
 * Pure file naming, MIME, and extension helpers for export formats.
 * @module dsh-zotero/client/export-formats
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatTime } from './presenters.ts'
import type { ExportArtifact } from './sources/model.ts'

/** Localized display label for one export format. */
export function formatLabelOf(format: string, t: TranslateNS<'zotero'>): string {
  switch (format) {
    case 'bibtex':
      return 'BibTeX'
    case 'biblatex':
      return 'BibLaTeX'
    case 'ris':
      return 'RIS'
    case 'csljson':
      return 'CSL JSON'
    case 'citation':
      return t('formatCitation')
    case 'bibliography':
      return t('formatBibliography')
    default:
      // An artifact without a usable projection meta keeps a named title.
      return format === '' ? t('formatUnknown') : format
  }
}

/** The file extension of one export format; unknown formats keep `.txt`. */
export function extensionOf(format: string): string {
  switch (format) {
    case 'bibtex':
    case 'biblatex':
      return '.bib'
    case 'ris':
      return '.ris'
    case 'csljson':
      return '.json'
    case 'citation':
    case 'bibliography':
      return '.txt'
    default:
      return '.txt'
  }
}

/**
 * The MIME type of one export format for the download blob. BibTeX/BibLaTeX
 * intentionally fall through to `text/plain`: no registered BibTeX MIME type
 * exists, and `text/plain` downloads verbatim everywhere.
 */
export function mimeOf(format: string): string {
  switch (format) {
    case 'ris':
      return 'application/x-research-info-systems'
    case 'csljson':
      return 'application/json'
    case 'citation':
    case 'bibliography':
      return 'text/plain'
    default:
      return 'text/plain'
  }
}

/** Sanitize a download filename stem: no path, separator, or control chars. */
export function sanitizeFileStem(stem: string): string {
  const cleaned = stem === '' ? 'export' : stem
  return cleaned.replace(/[/\\:*?"<>|\x00-\x1F]/g, '-')
}

/**
 * The download filename of one translator format: `zotero-<format><ext>`.
 * The stem is the translator id, never the display label, because a localized
 * "引文" is not a filename. Every download surface builds its name here so the
 * three of them cannot drift.
 */
export function fileNameForFormat(format: string): string {
  return `zotero-${sanitizeFileStem(format)}${extensionOf(format)}`
}

/** The download filename of one export artifact, from its translator format. */
export function fileNameOf(artifact: ExportArtifact): string {
  return fileNameForFormat(artifact.format)
}

/** Format the artifact's settled event time as an absolute HH:MM time. */
export function artifactTimeOf(artifact: ExportArtifact): string {
  if (artifact.settledAt === undefined) return ''
  return formatTime(artifact.settledAt, false)
}
