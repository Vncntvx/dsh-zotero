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
  resultFirstTextOf,
  resultTextOf,
  textArg,
} from '../../sources/presenters.js'
import { RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import { CitationKeyConflictNotice } from '../components/CitationKeyConflictNotice.tsx'
import css from './toolviews.module.css'
import linkCss from '../components/link.module.css'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

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
      // artifact. The completed body is the first text block: the render keeps
      // the mapping and the notes in a second block so neither can reach the
      // copy/download surface.
      rawText: job === null ? (resultFirstTextOf(block) ?? '') : '',
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // The translator id, not the display label: the
                        // extension and MIME type are the format's, and a
                        // localized label is neither.
                        downloadBlob(rawText, fileNameForFormat(format), mimeOf(format))
                      }}
                    >
                      {`${t('downloadArtifact')} ${extensionOf(format)}`}
                    </Button>
                  </div>
                </div>
                <CodeBlock
                  code={rawText}
                  lang={format}
                  showHeader={false}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                  className={css.rawCode}
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
                          className={linkCss.linkDense}
                          openProtocol={client.openProtocol}
                        />
                      </div>
                      <div className={css.itemMeta}>{t('toolRefLine', { ref: item.ref })}</div>
                      {item.exportKey && (
                        <div className={css.itemMeta}>
                          {t('toolExportKeyLine', { key: item.exportKey })}
                        </div>
                      )}
                      {item.citationKey && (
                        <div className={css.itemMeta}>
                          {t('toolExportCitationKeyLine', {
                            source: item.citationKeySource ? ` (${item.citationKeySource})` : '',
                            key: item.citationKey,
                          })}
                        </div>
                      )}
                      <CitationKeyConflictNotice conflict={item.citationKeyConflict} t={t} />
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
