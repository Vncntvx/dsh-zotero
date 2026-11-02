import { readCompleteResult, ResultSessionContext, rawExportText } from '../result-reader.ts'
/**
 * One export artifact as a disclosure row: format name in proper case
 * (BibTeX, not "bibtex"), scope facts and the settled time on the head
 * line, copy and download actions after the complete body has loaded (the
 * download names its extension), and the body preview behind the toggle,
 * a layer-2 code surface with its own padding, rounding, and scroll, so a
 * long BibTeX or RIS body never stretches the row. The BibTeX keys and the
 * \cite convenience live inside the expanded body, not in the title. The
 * timestamp is the settled result's event time (absolute time, no relative
 * "just now" that would need a timer). Only successful exports appear here.
 * @module dsh-zotero/client/components/ExportCard
 */

import { useContext, useMemo, useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { bibTexKeysOf, citeCommandOf } from '../sources/bibtex.ts'
import type { ExportArtifact } from '../sources/model.ts'
import { downloadBlob } from '../download.ts'
import quiet from './quiet.module.css'
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
  const pending = useRef<AbortController>()
  useEffect(() => () => pending.current?.abort(), [])
  const [loadedText, setLoadedText] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const text = artifact.resultFile ? loadedText : artifact.text
  const load = async () => {
    if (!sessionId || !artifact.resultFile) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setError(undefined)
    try {
      const data = await readCompleteResult(sessionId, artifact.resultFile, controller.signal)
      controller.signal.throwIfAborted()
      const raw = rawExportText(data)
      if (raw === undefined) throw new Error(t('resultReadFailed'))
      setLoadedText(raw)
    } catch {
      setError(t('resultReadFailed'))
    } finally {
      setLoading(false)
    }
  }
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
          {text === undefined ? (
            <button
              type="button"
              className={quiet.quiet}
              disabled={loading || !sessionId}
              onClick={() => {
                void load()
              }}
            >
              {t('readCompleteResult')}
            </button>
          ) : (
            <>
              <CopyButton value={text} label={t('copyExport')} copiedLabel={t('copied')} />
              <button type="button" className={quiet.quiet} onClick={download}>
                {`${t('downloadArtifact')} ${extensionOf(artifact.format)}`}
              </button>
            </>
          )}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      {open && (
        <div className={css.exportBody}>
          {citeCommand !== '' && (
            <p className={css.exportKeys} title={citeCommand}>
              <span className={css.exportKeysText}>{keys.join(' · ')}</span>
              <CopyButton value={citeCommand} label={t('copyCite')} copiedLabel={t('copied')} />
            </p>
          )}
          {text !== undefined && text.length > 2000 && <p>{t('exportDisplayPreview')}</p>}
          <pre className={css.exportPre}>{text?.slice(0, 2000)}</pre>
        </div>
      )}
    </section>
  )
}
