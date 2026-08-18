/**
 * One export artifact as a disclosure row: format name in proper case
 * (BibTeX, not "bibtex"), scope facts and the settled time on the head
 * line, copy and download as the always-visible primary actions (the
 * download names its extension), and the verbatim body behind the toggle —
 * a layer-2 code surface with its own padding, rounding, and scroll, so a
 * long BibTeX or RIS body never stretches the row. The BibTeX keys and the
 * \cite convenience live inside the expanded body, not in the title. The
 * timestamp is the settled result's event time (absolute time, no relative
 * "just now" that would need a timer). Only successful exports appear here.
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

/**
 * The display label of one export format: the known translator ids in
 * proper case, the CSL formats localized; unknown names stay verbatim.
 */
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

/** Sanitize a title into a download filename: no path or separator chars. */
export function fileNameOf(artifact: ExportArtifact): string {
  const base = artifact.format === '' ? 'export' : artifact.format
  const cleaned = base.replace(/[/\\:*?"<>|]/g, '-')
  return `zotero-${cleaned}${extensionOf(artifact.format)}`
}

/** Format the artifact's settled event time as an absolute HH:MM time. */
export function artifactTimeOf(artifact: ExportArtifact): string {
  if (artifact.settledAt === undefined) return ''
  const date = new Date(artifact.settledAt)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface ExportCardProps {
  readonly artifact: ExportArtifact
  readonly t: TranslateNS<'zotero'>
}

/** One successful export artifact as a disclosure row. */
export function ExportCard({ artifact, t }: ExportCardProps) {
  const [open, setOpen] = useState(false)
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
  const timeLabel = artifactTimeOf(artifact)

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

  const headFacts = [
    interpolate(t('exportRefCount'), { count: artifact.refs.length }) +
      (artifact.refsOmitted > 0
        ? ` · ${interpolate(t('exportRefsOmitted'), { count: artifact.refsOmitted })}`
        : ''),
    ...(artifact.style !== undefined ? [artifact.style] : []),
    ...(artifact.locale !== undefined ? [artifact.locale] : []),
    ...(timeLabel !== '' ? [timeLabel] : []),
  ].join(' · ')

  return (
    <section className={css.exportRow} data-export-card>
      <div className={css.exportHead}>
        <button
          type="button"
          className={css.exportToggle}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <span className={css.exportTitle}>{formatLabelOf(artifact.format, t)}</span>
          <span className={css.exportFacts}>{headFacts}</span>
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>
        <span className={css.lineActions}>
          <CopyButton value={artifact.text} label={t('copyExport')} copiedLabel={t('copied')} />
          <button type="button" className={css.lineAction} onClick={download}>
            {`${t('downloadArtifact')} ${extensionOf(artifact.format)}`}
          </button>
        </span>
      </div>
      {open && (
        <div className={css.exportBody}>
          {citeCommand !== '' && (
            <p className={css.exportKeys} title={citeCommand}>
              <span className={css.exportKeysText}>{keys.join(' · ')}</span>
              <CopyButton value={citeCommand} label={t('copyCite')} copiedLabel={t('copied')} />
            </p>
          )}
          <pre className={css.exportPre}>{artifact.text}</pre>
        </div>
      )}
    </section>
  )
}
