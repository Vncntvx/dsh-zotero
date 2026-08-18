/**
 * One export artifact card: the format and scope facts, the bounded ref
 * list, the BibTeX key convenience, and the collapsible export body with
 * its copy button. Only successful exports appear here; the lens states
 * that a static export never inserts into Word, Google Docs, or
 * LibreOffice documents.
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
      return format
  }
}

export interface ExportCardProps {
  readonly artifact: ExportArtifact
  readonly ordinal: number
  readonly t: TranslateNS<'zotero'>
}

/** One successful export artifact card. */
export function ExportCard({ artifact, ordinal, t }: ExportCardProps) {
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
        <CopyButton value={artifact.text} label={t('copyExport')} t={t} />
        {citeCommand !== '' && <CopyButton value={citeCommand} label={t('copyCite')} t={t} />}
      </span>
      {open && (
        <div className={css.exportBody}>
          <p className={css.line}>{artifact.text}</p>
        </div>
      )}
    </section>
  )
}
