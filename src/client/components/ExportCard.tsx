/**
 * One export artifact as a disclosure row: format name in proper case
 * (BibTeX, not "bibtex"), scope facts and the settled time on the head
 * line, copy and download actions after the complete body has loaded (the
 * download names its extension), and the body preview behind the toggle. The
 * body is the host code block, and `.exportCode` bounds it to 280px of
 * self-scrolling height, so a long BibTeX or RIS body never stretches the
 * row. The BibTeX keys and the \cite convenience live inside the expanded
 * body, not in the title. The timestamp is the settled result's event time
 * (absolute time, no relative "just now" that would need a timer). Only
 * successful exports appear here.
 * @module dsh-zotero/client/components/ExportCard
 */

import { useContext, useMemo, useState } from 'react'
import {
  CodeBlock,
  DisclosureRow,
  IconChevronDownOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { bibTexKeysOf, citeCommandOf } from '../../sources/bibtex.js'
import type { ExportArtifact } from '../../sources/model.js'
import { downloadBlob } from '../download.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { CopyButton } from './CopyButton.tsx'
import css from './cards.module.css'
import { useCompleteResult } from './useCompleteResult.ts'
import { ResultSessionContext } from '../result-reader.ts'
import {
  RESULT_PREVIEW_CHARS,
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
export function ExportCard(props: ExportCardProps) {
  const sessionId = useContext(ResultSessionContext)
  const key = `${sessionId}:${props.artifact.callId}:${props.artifact.resultFile?.seq}`
  return <ExportCardBody key={key} {...props} sessionId={sessionId} />
}
function ExportCardBody({
  artifact,
  t,
  sessionId,
}: ExportCardProps & { sessionId: string | undefined }) {
  const [open, setOpen] = useState(false)
  const { state, load } = useCompleteResult({
    sessionId,
    coordinates: artifact.resultFile,
    requireExportText: true,
    failureMessage: t('resultReadFailed'),
  })
  const text = artifact.resultFile ? state.body?.text : artifact.text
  // Key extraction is only meaningful for the BibTeX family; other bodies
  // can be large, so the regex never runs on them.
  const keys = useMemo(
    () =>
      artifact.format === 'bibtex' || artifact.format === 'biblatex'
        ? bibTexKeysOf(text ?? '')
        : [],
    [artifact.format, text],
  )
  const citeCommand = useMemo(() => citeCommandOf(keys), [keys])
  const timeLabel = artifactTimeOf(artifact)

  const download = (): void => {
    if (text === undefined) return
    downloadBlob(text, fileNameOf(artifact), mimeOf(artifact.format))
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
      <DisclosureRow
        icon={<IconChevronDownOutlineRegular />}
        previewChevron={false}
        title={formatLabelOf(artifact.format, t)}
        titleClassName={css.exportTitle}
        open={open}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => {
          setOpen(!open)
        }}
        collapsedContent={<span className={css.exportFacts}>{headFacts}</span>}
        headerAccessory={
          <span className={css.lineActions}>
            {text === undefined ? (
              <Button
                variant="outline"
                size="sm"
                disabled={state.loading || !sessionId}
                onClick={() => {
                  void load()
                }}
              >
                {t('readCompleteResult')}
              </Button>
            ) : (
              <>
                <CopyButton value={text} label={t('copyExport')} copiedLabel={t('copied')} />
                <Button variant="outline" size="sm" onClick={download}>
                  {`${t('downloadArtifact')} ${extensionOf(artifact.format)}`}
                </Button>
              </>
            )}
          </span>
        }
      >
        <div className={css.exportBody}>
          {citeCommand !== '' && (
            <p className={css.exportKeys} title={citeCommand}>
              <span className={css.exportKeysText}>{keys.join(' · ')}</span>
              <CopyButton value={citeCommand} label={t('copyCite')} copiedLabel={t('copied')} />
            </p>
          )}
          {text !== undefined && text.length > RESULT_PREVIEW_CHARS && (
            <p>{t('exportDisplayPreview')}</p>
          )}
          <CodeBlock
            code={text?.slice(0, RESULT_PREVIEW_CHARS) ?? ''}
            lang={artifact.format}
            copyLabel={t('copyExport')}
            copiedLabel={t('copied')}
            showHeader={false}
            className={css.exportCode}
          />
        </div>
      </DisclosureRow>
      {state.error && <p role="alert">{state.error}</p>}
    </section>
  )
}
