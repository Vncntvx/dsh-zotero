/**
 * One export artifact card: the format and scope facts, the bounded ref
 * list, the BibTeX key convenience, the download action (format-aware
 * extension, blob URL released after use), and the collapsible export body.
 * The body renders only the preview lines until expanded — the full text
 * enters the DOM only on demand — while copy and download always use the
 * complete artifact text. The timestamp is the settled result's event time
 * (absolute time, no relative "just now" that would need a timer). Only
 * successful exports appear here; the lens states that a static export
 * never inserts into Word, Google Docs, or LibreOffice documents.
 * @module dsh-zotero/client/components/ExportCard
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../presenters.ts'
import { bibTexKeysOf, citeCommandOf } from '../sources/bibtex.ts'
import type { ExportArtifact } from '../sources/model.ts'
import { CopyButton } from './CopyButton.tsx'
import css from './SourcesList.module.css'

/** The display label of one export format; the translator names stay verbatim. */
export function formatLabelOf(format: string, t: TranslateNS<'zotero'>): string {
  switch (format) {
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

/** The MIME type of one export format for the download blob. */
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

/** The lines the collapsed body renders before the full text is expanded. */
export const PREVIEW_LINE_COUNT = 12

/** Sanitize a title into a download filename: no path or separator chars. */
export function fileNameOf(artifact: ExportArtifact): string {
  const base = artifact.format === '' ? 'export' : artifact.format
  const cleaned = base.replace(/[/\\:*?"<>|]/g, '-')
  return `zotero-${cleaned}${extensionOf(artifact.format)}`
}

/** Format the artifact's settled event time as an absolute HH:MM time. */
export function artifactTimeOf(artifact: ExportArtifact, t: TranslateNS<'zotero'>): string {
  if (artifact.settledAt === undefined) return ''
  const date = new Date(artifact.settledAt)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${t('artifactAtLabel')} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface ExportCardProps {
  readonly artifact: ExportArtifact
  readonly ordinal: number
  readonly t: TranslateNS<'zotero'>
}

/** One successful export artifact card. */
export function ExportCard({ artifact, ordinal, t }: ExportCardProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Key extraction is only meaningful for the BibTeX family; other bodies
  // can be large, so the regex never runs on them.
  const keys = useMemo(
    () =>
      artifact.format === 'bibtex' || artifact.format === 'biblatex'
        ? bibTexKeysOf(artifact.text)
        : [],
    [artifact.format, artifact.text],
  )
  const citeCommand = useMemo(() => citeCommandOf(keys), [keys])
  const lines = useMemo(() => artifact.text.split('\n'), [artifact.text])
  const previewLines = lines.slice(0, PREVIEW_LINE_COUNT)
  const truncated = lines.length > PREVIEW_LINE_COUNT
  const timeLabel = artifactTimeOf(artifact, t)

  const download = (): void => {
    const blob = new Blob([artifact.text], { type: mimeOf(artifact.format) })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileNameOf(artifact)
    anchor.click()
    // The blob URL must not outlive the click.
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
  }

  return (
    <section className={css.card} data-export-card>
      <button
        type="button"
        className={css.cardHead}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className={css.cardTitle}>
          {ordinal}. {formatLabelOf(artifact.format, t)}
        </span>
        {timeLabel !== '' && <span className={css.note}>{timeLabel}</span>}
        {artifact.style !== undefined && <span className={css.note}>{artifact.style}</span>}
        {artifact.locale !== undefined && <span className={css.note}>{artifact.locale}</span>}
        <span className={css.note}>
          {interpolate(t('exportRefCount'), { count: artifact.refs.length })}
          {artifact.refsOmitted > 0
            ? ` · ${interpolate(t('exportRefsOmitted'), { count: artifact.refsOmitted })}`
            : ''}
        </span>
        {keys.length > 0 && (
          <span className={css.note} title={citeCommand}>
            {keys.join(' · ')}
          </span>
        )}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      <span className={css.lineActions}>
        <CopyButton value={artifact.text} label={t('copyExport')} copiedLabel={t('copied')} />
        {citeCommand !== '' && (
          <CopyButton value={citeCommand} label={t('copyCite')} copiedLabel={t('copied')} />
        )}
        <button type="button" className={css.lineAction} onClick={download}>
          {t('downloadArtifact')}
        </button>
      </span>
      {open && (
        <div className={css.exportBody}>
          <p className={css.line}>
            {expanded ? artifact.text : `${previewLines.join('\n')}${truncated ? `\n…` : ''}`}
          </p>
          {truncated && (
            <button
              type="button"
              className={css.expandToggle}
              onClick={() => {
                setExpanded(!expanded)
              }}
            >
              {expanded ? t('collapseFullText') : t('expandFullText')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
