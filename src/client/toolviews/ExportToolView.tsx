/**
 * Dedicated toolview card for `zotero_export`.
 * Renders formatted citations or BibTeX code blocks with one-click copy and item attribution.
 * @module dsh-zotero/client/toolviews/ExportToolView
 */

import { useMemo } from 'react'
import { IconCopyOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { exportMetaOf } from '../sources/decoders.ts'
import { selectUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import { CopyButton } from '../components/CopyButton.tsx'
import { formatLabelOf } from '../components/ExportCard.tsx'
import { argsOf, errorSummaryOf, metaOf, resultTextOf, stringField } from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type ExportToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_export'> &
  PropsLocale<'zotero'>

export function ExportToolView(props: ExportToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const { formatLabel, refsCount, summary, errorSummary, items, rawText } = useMemo(() => {
    const raw = (resultTextOf(block) ?? '').trim()
    const errSummary = errorSummaryOf(block, raw)
    const args = argsOf(block)
    const formatArg = stringField(args ?? {}, 'format') ?? 'bibtex'
    const meta = metaOf(block)
    const exportView = meta !== null ? exportMetaOf(meta) : null
    const rawFmt = exportView?.format || formatArg
    const label = formatLabelOf(rawFmt, t)
    const count =
      exportView?.refs.length ?? (Array.isArray(args?.['refs']) ? args['refs'].length : 0)

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = t('toolExportRunning')
    } else {
      sum = t('toolSummaryExport', { format: label, count })
    }

    const mappedItems = (exportView?.items ?? []).map((item) => ({
      ...item,
      selectUrl: selectUrlOf(item.ref),
    }))

    return {
      formatLabel: label,
      refsCount: count,
      summary: sum,
      errorSummary: errSummary,
      items: mappedItems,
      rawText: raw,
    }
  }, [block, t])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={<IconCopyOutlineRegular size={14} />}
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
            {rawText ? (
              <div className={css.codeWrap}>
                <div className={css.codeHeader}>
                  <div className={css.evidenceBadges}>
                    <span className={css.badge} data-tone="info">
                      {formatLabel}
                    </span>
                    {refsCount > 0 && (
                      <span className={css.badge}>{t('exportRefCount', { count: refsCount })}</span>
                    )}
                  </div>
                  <CopyButton
                    value={rawText}
                    label={t('copy')}
                    copiedLabel={t('copied')}
                    className={css.lineAction}
                  />
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
