/**
 * Dedicated toolview card for `zotero_search`.
 * Renders literature search hits, metadata badges, notes matches, and Zotero open links.
 * @module dsh-zotero/client/toolviews/SearchToolView
 */

import { useMemo } from 'react'
import { IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { searchMetaOf } from '../sources/decoders.ts'
import { selectUrlOf, pdfUrlOf } from '../actions/open-zotero.ts'
import { ZoteroOpenLink } from '../components/open/ZoteroOpenLink.tsx'
import {
  argsOf,
  errorSummaryOf,
  metaOf,
  numberField,
  resultTextOf,
  stringField,
} from '../presenters.ts'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type SearchToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_search'> &
  PropsLocale<'zotero'>

export function SearchToolView(props: SearchToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const { query, summary, errorSummary, rows, rawText } = useMemo(() => {
    const args = argsOf(block)
    const q = (stringField(args ?? {}, 'query') ?? '').trim()
    const meta = metaOf(block)
    const searchView = meta !== null ? searchMetaOf(meta) : null
    const noteMatches = meta !== null ? (numberField(meta, 'noteMatches') ?? 0) : 0
    const raw = (resultTextOf(block) ?? '').trim()

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = q ? `"${q}"` : t('toolSearchRunning')
    } else if (searchView?.rows !== null && searchView?.rows !== undefined) {
      const count = searchView.rows.length
      sum =
        noteMatches > 0
          ? t('toolSummaryFoundWithNotes', { count, notes: noteMatches })
          : t('toolSummaryFound', { count })
    } else {
      sum = q ? `"${q}"` : t('toolTitleSearch')
    }

    const errSummary = errorSummaryOf(block, raw)

    const items = (searchView?.rows ?? []).map((row) => ({
      ...row,
      selectUrl: selectUrlOf(row.ref),
      pdfUrl: row.bestAttachmentRef ? pdfUrlOf(row.bestAttachmentRef) : null,
    }))

    return {
      query: q,
      summary: sum,
      errorSummary: errSummary,
      rows: items,
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
      icon={<IconSearchOutlineRegular size={14} />}
      title={t('toolTitleSearch')}
      summary={summary}
      summarySuffix={query ? `"${query}"` : null}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolSearchRunning')} />
        }

        if (rows.length > 0) {
          return (
            <div className={css.cardList}>
              {rows.map((row) => (
                <div key={row.ref} className={css.itemCard}>
                  <div className={css.itemHeader}>
                    {row.year !== undefined && <span className={css.badge}>{row.year}</span>}
                    {row.bestAttachmentType && (
                      <span className={css.badge} data-tone="pdf">
                        {t('badgePdf')}
                      </span>
                    )}
                    <span className={css.itemTitle}>{row.title}</span>
                  </div>
                  {row.creatorSummary && <div className={css.itemMeta}>{row.creatorSummary}</div>}
                  <div className={css.itemActions}>
                    {row.selectUrl && (
                      <ZoteroOpenLink
                        url={row.selectUrl}
                        verdict="open"
                        label={t('openInZotero')}
                        t={t}
                        className={css.actionLink}
                      />
                    )}
                    {row.pdfUrl && (
                      <ZoteroOpenLink
                        url={row.pdfUrl}
                        verdict="open"
                        label={t('openPdf')}
                        t={t}
                        className={css.actionLink}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        }

        return rawText ? (
          <RawTextFallback text={rawText} />
        ) : (
          <div className={css.coverageNotice}>{t('toolNoResults')}</div>
        )
      }}
    </ZoteroToolRow>
  )
}
