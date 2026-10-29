/**
 * One export artifact as a disclosure row: format name in proper case
 * (BibTeX, not "bibtex"), scope facts and the settled time on the head
 * line, copy and download as the always-visible primary actions (the
 * download names its extension), and the verbatim body behind the toggle,
 * a layer-2 code surface with its own padding, rounding, and scroll, so a
 * long BibTeX or RIS body never stretches the row. The BibTeX keys and the
 * \cite convenience live inside the expanded body, not in the title. The
 * timestamp is the settled result's event time (absolute time, no relative
 * "just now" that would need a timer). Only successful exports appear here.
 * @module dsh-zotero/client/components/ExportCard
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Button, IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { bibTexKeysOf, citeCommandOf } from '../sources/bibtex.ts'
import type { ExportArtifact } from '../sources/model.ts'
import { downloadBlob } from '../download.ts'
import { CopyButton } from './CopyButton.tsx'
import css from './cards.module.css'
import {
  artifactTimeOf,
  extensionOf,
  fileNameOf,
  formatLabelOf,
  mimeOf,
} from '../export-formats.ts'

interface ExportCardProps {
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
    downloadBlob(artifact.text, fileNameOf(artifact), mimeOf(artifact.format))
  }

  const headFacts = [
    t('exportRefCount', { count: artifact.refs.length }) +
      (artifact.refsOmitted > 0
        ? ` · ${t('exportRefsOmitted', { count: artifact.refsOmitted })}`
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
          <IconChevronDownOutlineMedium className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>
        <span className={css.lineActions}>
          <CopyButton value={artifact.text} label={t('copyExport')} copiedLabel={t('copied')} />
          <Button variant="outline" size="sm" className={css.lineAction} onClick={download}>
            {`${t('downloadArtifact')} ${extensionOf(artifact.format)}`}
          </Button>
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
