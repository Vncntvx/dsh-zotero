/**
 * Dedicated toolview card for `zotero_export`.
 * Renders formatted citations or BibTeX code blocks with one-click copy and item attribution.
 * @module dsh-zotero/client/toolviews/ExportToolView
 */

import { useMemo } from 'react'
import { IconCopyOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { exportMetaOf, jobArmOf, jobSummaryKeyOf } from '../sources/decoders.ts'
import { selectUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
import { extensionOf, fileNameForFormat, formatLabelOf, mimeOf } from '../components/ExportCard.tsx'
import { downloadBlob } from '../download.ts'
import { argsOf, errorSummaryOf, metaOf, resultTextOf, stringField } from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type ExportToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_export'> &
  PropsLocale<'zotero'>

export function ExportToolView(props: ExportToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const {
    icon,
    format,
    formatLabel,
    refsCount,
    style,
    locale,
    summary,
    errorSummary,
    items,
    rawText,
    job,
  } = useMemo(() => {
    const raw = (resultTextOf(block) ?? '').trim()
    const errSummary = errorSummaryOf(block, raw)
    const args = argsOf(block)
    const formatArg = stringField(args ?? {}, 'format') ?? 'bibtex'
    const meta = metaOf(block)
    const exportView = meta !== null ? exportMetaOf(meta) : null
    const job = meta !== null ? jobArmOf(meta) : null
    const rawFmt = exportView?.format || formatArg
    const label = formatLabelOf(rawFmt, t)
    const count =
      exportView?.refs.length ?? (Array.isArray(args?.['refs']) ? args['refs'].length : 0)

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = t('toolExportRunning')
    } else {
      // A long call is handed to a background job rather than answered inline.
      // The job id is the one value the reader needs to collect the result, so
      // the summary names it instead of reporting a count it never produced.
      sum =
        job === null
          ? t('toolSummaryExport', { format: label, count })
          : t(jobSummaryKeyOf(job), { jobId: job.jobId })
    }

    const mappedItems = (exportView?.items ?? []).map((item) => ({
      ...item,
      selectUrl: selectUrlOf(item.ref),
    }))

    return {
      icon: <IconCopyOutlineRegular size={14} />,
      // The translator id, not its display label: the download's extension and
      // MIME type are the format's, and a localized label is neither.
      format: rawFmt,
      formatLabel: label,
      refsCount: count,
      // The CSL style and locale the call actually resolved. Without them a
      // citation's rendering is unknowable from the card, and the Exports
      // panel already states both beside the format.
      style: exportView?.style ?? null,
      locale: exportView?.locale ?? null,
      summary: sum,
      errorSummary: errSummary,
      items: mappedItems,
      // A job arm's text is only an acknowledgement, never an export
      // artifact. Keep it out of the code/download surface until job_output
      // supplies the completed translator text.
      rawText: job === null ? raw : '',
      job,
    }
  }, [block, t])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={t('toolTitleExport')}
      summary={summary}
      summarySuffix={null}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolExportRunning')} />
        }

        return (
          <>
            {job !== null ? (
              <div className={css.coverageNotice}>
                {t('toolSummaryJobPending', { jobId: job.jobId })}
              </div>
            ) : rawText ? (
              <div className={css.codeWrap}>
                <div className={css.codeHeader}>
                  <div className={css.evidenceBadges}>
                    <span className={css.badge} data-tone="info">
                      {formatLabel}
                    </span>
                    {refsCount > 0 && (
                      <span className={css.badge}>{t('exportRefCount', { count: refsCount })}</span>
                    )}
                    {style !== null && <span className={css.badge}>{style}</span>}
                    {locale !== null && <span className={css.badge}>{locale}</span>}
                  </div>
                  <div className={css.itemActions}>
                    <CopyButton
                      value={rawText}
                      label={t('copy')}
                      copiedLabel={t('copied')}
                      className={css.lineAction}
                    />
                    <button
                      type="button"
                      className={css.lineAction}
                      onClick={() => {
                        // The translator id, not the display label: the
                        // extension and MIME type are the format's, and a
                        // localized label is neither.
                        downloadBlob(rawText, fileNameForFormat(format), mimeOf(format))
                      }}
                    >
                      {`${t('downloadArtifact')} ${extensionOf(format)}`}
                    </button>
                  </div>
                </div>
                <RawTextFallback text={rawText} />
              </div>
            ) : (
              <div className={css.coverageNotice}>{t('toolNoResults')}</div>
            )}

            {items.length > 0 && (
              <div className={css.notesSection}>
                <span className={css.sectionTitle}>{t('lensSources')}</span>
                <div className={css.cardList}>
                  {items.map((item) => (
                    <div key={item.ref} className={css.itemHeader}>
                      <span className={css.itemTitle}>{item.title || item.ref}</span>
                      {item.selectUrl && (
                        <ZoteroOpenLink
                          url={item.selectUrl}
                          verdict="open"
                          label={t('openInZotero')}
                          t={t}
                          className={css.actionLink}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
