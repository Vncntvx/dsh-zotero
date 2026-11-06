/**
 * Dedicated toolview card for `zotero_export`.
 * Renders formatted citations or BibTeX code blocks with one-click copy and item attribution.
 * @module dsh-zotero/client/toolviews/ExportToolView
 */

import { useMemo } from 'react'
import { CodeBlock, IconCopyOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { exportMetaOf } from '../../sources/export-decoder.js'
import { jobArmOf, jobSummaryKeyOf } from '../sources/sync-decoder.ts'
import { ZoteroLocateActions } from '../components/open/ZoteroLocateActions.tsx'
import { extensionOf, fileNameForFormat, formatLabelOf, mimeOf } from '../export-formats.ts'
import { downloadBlob } from '../download.ts'
import {
  argsViewOf,
  errorSummaryOf,
  isToolRunning,
  listArg,
  metaOf,
  resultTextOf,
  textArg,
} from '../../sources/presenters.js'
import { RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'
import quiet from '../components/quiet.module.css'

type ExportToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_export'> &
  PropsLocale<'zotero'>

export function ExportToolView(props: ExportToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props
  const client = props.useZoteroClient()

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
    detailOmitted,
  } = useMemo(() => {
    const raw = resultTextOf(block) ?? ''
    const errSummary = errorSummaryOf(block, raw)
    const args = argsViewOf(block)
    const formatArg = textArg(args, 'format') ?? 'bibtex'
    const meta = metaOf(block)
    const exportView = meta !== null ? exportMetaOf(meta) : null
    const job = meta !== null ? jobArmOf(meta) : null
    const rawFmt = exportView?.format || formatArg
    const label = formatLabelOf(rawFmt, t)
    const count = exportView?.refs.length ?? listArg(args, 'refs').length

    let sum = ''
    if (isToolRunning(block)) {
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
      items: exportView?.items ?? [],
      // A job arm's text is only an acknowledgement, never an export
      // artifact. Keep it out of the code/download surface until job_output
      // supplies the completed translator text.
      rawText: job === null && typeof meta?.text === 'string' ? meta.text : '',
      job,
      detailOmitted: exportView?.detailOmitted === true,
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
                    <Tag tone="info">{formatLabel}</Tag>
                    {refsCount > 0 && (
                      <Tag tone="neutral">{t('exportRefCount', { count: refsCount })}</Tag>
                    )}
                    {style !== null && <Tag tone="neutral">{style}</Tag>}
                    {locale !== null && <Tag tone="neutral">{locale}</Tag>}
                  </div>
                  <div className={css.itemActions}>
                    <button
                      type="button"
                      className={quiet.quietDense}
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
                <CodeBlock
                  code={rawText}
                  lang={format}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                />
              </div>
            ) : (
              <div className={css.coverageNotice}>{t('toolNoResults')}</div>
            )}

            {items.length > 0 && (
              <div className={css.notesSection}>
                <span className={css.sectionTitle}>{t('lensSources')}</span>
                <div className={css.cardList}>
                  {items.map((item) => (
                    <div key={item.ref} className={css.itemCard}>
                      <div className={css.itemHeader}>
                        <span className={css.itemTitle}>{item.title || item.ref}</span>
                        <ZoteroLocateActions
                          title={item.title}
                          itemRef={item.ref}
                          t={t}
                          variant="link"
                          className={css.actionLink}
                          openProtocol={client.openProtocol}
                        />
                      </div>
                      <div className={css.itemMeta}>ref: {item.ref}</div>
                      {item.exportKey && (
                        <div className={css.itemMeta}>exportKey: {item.exportKey}</div>
                      )}
                      {item.citationKey && (
                        <div className={css.itemMeta}>
                          Zotero citationKey
                          {item.citationKeySource ? ` (${item.citationKeySource})` : ''}:{' '}
                          {item.citationKey}
                        </div>
                      )}
                      {item.citationKeyConflict && (
                        <div className={css.coverageNotice}>
                          Citation key conflict: native={item.citationKeyConflict.native}; extra=
                          {item.citationKeyConflict.extra}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detailOmitted && <div className={css.coverageNotice}>{t('detailOmittedNote')}</div>}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
