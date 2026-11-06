/**
 * One exported document as a disclosure row: the citation key in code type
 * as the main line (the title when the format carries no key, as RIS records
 * have none), the paper title as the weak second line, and the per-document
 * actions (the `\cite{}` copy for the BibTeX family, the single-document
 * download) outside the toggle. The verbatim entry body sits behind the
 * toggle, drawn by the host code block and bounded by `.exportCode`; `lang`
 * carries the raw translator id as the grammar hint, matching the tool card
 * and the export artifact card, while the localized format name rides in a
 * tag beside the row actions. The key stays the row's visible title:
 * `DisclosureRow` takes no title, so the old native key tooltip has no home.
 * @module dsh-zotero/client/components/ExportDocumentRow
 */

import { useMemo, useState } from 'react'
import {
  Button,
  CodeBlock,
  DisclosureRow,
  IconChevronDownOutlineRegular,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { shortKeyOf } from '../../sources/presenters.js'
import { citeCommandOf } from '../../sources/bibtex.js'
import type { ExportedDocument } from '../sources/selectors.ts'
import { downloadBlob } from '../download.ts'
import { extensionOf, formatLabelOf, mimeOf, sanitizeFileStem } from '../export-formats.ts'
import { CopyButton } from './CopyButton.tsx'
import css from './cards.module.css'

interface ExportDocumentRowProps {
  readonly doc: ExportedDocument
  readonly t: TranslateNS<'zotero'>
}

/** One exported document as a disclosure row. */
export function ExportDocumentRow({ doc, t }: ExportDocumentRowProps) {
  const [open, setOpen] = useState(false)
  // The cite command is only meaningful when the entry carries a key.
  const citeCommand = useMemo(
    () => (doc.exportKey === undefined ? '' : citeCommandOf([doc.exportKey])),
    [doc.exportKey],
  )
  const download = (): void => {
    const base = sanitizeFileStem(doc.exportKey ?? shortKeyOf(doc.ref) ?? 'export')
    downloadBlob(doc.text, `zotero-${base}${extensionOf(doc.format)}`, mimeOf(doc.format))
  }

  const title = doc.exportKey ?? doc.title ?? formatLabelOf(doc.format, t)

  return (
    <section className={css.exportRow} data-export-document>
      <DisclosureRow
        icon={<IconChevronDownOutlineRegular />}
        previewChevron={false}
        title={title}
        titleClassName={doc.exportKey === undefined ? css.exportTitle : css.documentKey}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => {
          setOpen(!open)
        }}
        headerAccessory={
          <span className={css.lineActions}>
            <Tag tone="info">{formatLabelOf(doc.format, t)}</Tag>
            {citeCommand !== '' && (
              <CopyButton value={citeCommand} label={t('copyCite')} copiedLabel={t('copied')} />
            )}
            <Button variant="outline" size="sm" onClick={download}>
              {`${t('downloadArtifact')} ${extensionOf(doc.format)}`}
            </Button>
          </span>
        }
      >
        <div className={css.exportBody}>
          <CodeBlock
            code={doc.text}
            lang={doc.format}
            copyLabel={t('copyExport')}
            copiedLabel={t('copied')}
            className={css.exportCode}
          />
        </div>
      </DisclosureRow>
      {doc.exportKey !== undefined && doc.title !== undefined && (
        <p className={css.documentTitle}>{doc.title}</p>
      )}
      {doc.citationKey !== undefined && (
        <p className={css.documentTitle}>
          {t('toolZoteroCitationKeyLine', {
            source: doc.citationKeySource ? ` (${doc.citationKeySource})` : '',
            key: doc.citationKey,
          })}
        </p>
      )}
      {doc.citationKeyConflict !== undefined && (
        <p className={css.documentTitle}>
          {t('toolCitationKeyConflict', {
            native: doc.citationKeyConflict.native,
            extra: doc.citationKeyConflict.extra,
          })}
        </p>
      )}
    </section>
  )
}
