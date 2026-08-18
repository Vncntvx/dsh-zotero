/**
 * One exported document as a disclosure row: the citation key in code type
 * as the main line (the title when the format carries no key — RIS records
 * have none), the paper title as the weak second line, and the per-document
 * actions — the `\cite{}` copy for the BibTeX family, the single-document
 * download — outside the toggle. The verbatim entry body sits behind the
 * toggle with the entry's copy action inside, so the row stays a document,
 * not a call.
 * @module dsh-zotero/client/components/ExportDocumentRow
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { shortKeyOf } from '../presenters.ts'
import { citeCommandOf } from '../sources/bibtex.ts'
import type { ExportedDocument } from '../sources/selectors.ts'
import { CopyButton } from './CopyButton.tsx'
import { extensionOf, formatLabelOf, mimeOf } from './ExportCard.tsx'
import css from './SourcesList.module.css'

export interface ExportDocumentRowProps {
  readonly doc: ExportedDocument
  readonly t: TranslateNS<'zotero'>
}

/** One exported document as a disclosure row. */
export function ExportDocumentRow({ doc, t }: ExportDocumentRowProps) {
  const [open, setOpen] = useState(false)
  // The cite command is only meaningful when the entry carries a key.
  const citeCommand = useMemo(
    () => (doc.key === undefined ? '' : citeCommandOf([doc.key])),
    [doc.key],
  )
  const download = (): void => {
    const blob = new Blob([doc.text], { type: mimeOf(doc.format) })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const base = doc.key ?? shortKeyOf(doc.ref) ?? 'export'
    anchor.href = url
    anchor.download = `zotero-${base}${extensionOf(doc.format)}`
    anchor.click()
    // The blob URL must not outlive the click.
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
  }

  return (
    <section className={css.exportRow} data-export-document>
      <div className={css.exportHead}>
        <button
          type="button"
          className={css.exportToggle}
          aria-expanded={open}
          title={doc.key}
          onClick={() => {
            setOpen(!open)
          }}
        >
          <span className={doc.key === undefined ? css.exportTitle : css.documentKey}>
            {doc.key ?? doc.title ?? formatLabelOf(doc.format, t)}
          </span>
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>
        <span className={css.lineActions}>
          {citeCommand !== '' && (
            <CopyButton value={citeCommand} label={t('copyCite')} copiedLabel={t('copied')} />
          )}
          <button type="button" className={css.lineAction} onClick={download}>
            {`${t('downloadArtifact')} ${extensionOf(doc.format)}`}
          </button>
        </span>
      </div>
      {doc.key !== undefined && doc.title !== undefined && (
        <p className={css.documentTitle}>{doc.title}</p>
      )}
      {open && (
        <div className={css.exportBody}>
          <div className={css.exportCode}>
            <div className={css.exportCodeHead}>
              <span className={css.exportCodeLabel}>{formatLabelOf(doc.format, t)}</span>
              <CopyButton value={doc.text} label={t('copyExport')} copiedLabel={t('copied')} />
            </div>
            <pre className={css.exportPre}>{doc.text}</pre>
          </div>
        </div>
      )}
    </section>
  )
}
