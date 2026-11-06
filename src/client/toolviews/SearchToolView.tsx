/**
 * Dedicated toolview card for `zotero_search`.
 * Renders literature search hits, metadata badges, notes matches, and Zotero open links.
 * @module dsh-zotero/client/toolviews/SearchToolView
 */

import { useMemo } from 'react'
import { IconSearchOutlineRegular, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { searchMetaOf } from '../../sources/decoders.js'
import { PdfReadButton } from '../components/open/PdfReadButton.tsx'
import { ZoteroLocateActions } from '../components/open/ZoteroLocateActions.tsx'
import {
  argsViewOf,
  errorSummaryOf,
  metaOf,
  isToolRunning,
  resultTextOf,
  textArg,
} from '../../sources/presenters.js'
import { RunningNotice, RawTextFallback, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'
import linkCss from '../components/link.module.css'

type SearchToolViewProps = PropsRuntime<'tool.call.toolview', 'zotero_search'> &
  PropsLocale<'zotero'>

export function SearchToolView(props: SearchToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props
  const client = props.useZoteroClient()

  const { icon, query, summary, errorSummary, rows, omitted, detailOmitted, rawText } =
    useMemo(() => {
      const args = argsViewOf(block)
      const q = (textArg(args, 'query') ?? '').trim()
      const meta = metaOf(block)
      const searchView = meta !== null ? searchMetaOf(meta) : null
      const noteMatches = searchView?.noteMatches ?? 0
      const raw = (resultTextOf(block) ?? '').trim()

      let sum = ''
      if (isToolRunning(block)) {
        sum = q ? `"${q}"` : t('toolSearchRunning')
      } else if (searchView?.rows !== null && searchView?.rows !== undefined) {
        // The hit count is the call's, not the projection's: `rows` is the
        // bounded page the card draws, which is capped independently of the
        // search's own `maxSearchResults`. Counting rows read 20 on a
        // deployment that raised the cap past the projection's.
        const count = searchView.returned ?? searchView.rows.length
        sum =
          noteMatches > 0
            ? t('toolSummaryFoundWithNotes', { count, notes: noteMatches })
            : t('toolSummaryFound', { count })
      } else {
        sum = q ? `"${q}"` : t('toolTitleSearch')
      }

      const errSummary = errorSummaryOf(block, raw)

      return {
        icon: <IconSearchOutlineRegular size={14} />,
        query: q,
        summary: sum,
        errorSummary: errSummary,
        rows: searchView?.rows ?? [],
        omitted: searchView?.omitted ?? 0,
        detailOmitted: searchView?.detailOmitted === true,
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
      icon={icon}
      title={t('toolTitleSearch')}
      summary={summary}
      summarySuffix={query ? `"${query}"` : null}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolSearchRunning')} />
        }

        return (
          <>
            {detailOmitted && <div className={css.coverageNotice}>{t('detailOmittedNote')}</div>}
            {rows.length > 0 ? (
              <>
                <div className={css.cardList}>
                  {rows.map((row) => (
                    <div key={row.ref} className={css.itemCard}>
                      <div className={css.itemHeader}>
                        {row.year !== undefined && <Tag tone="neutral">{row.year}</Tag>}
                        {row.itemType !== undefined && <Tag tone="info">{row.itemType}</Tag>}
                        {row.bestAttachmentType && <Tag tone="danger">{t('badgePdf')}</Tag>}
                        <span className={css.itemTitle}>
                          {row.title}
                          {row.citationKey !== undefined ? ` [@${row.citationKey}]` : ''}
                        </span>
                      </div>
                      {row.creatorSummary && (
                        <div className={css.itemMeta}>{row.creatorSummary}</div>
                      )}
                      {row.citationKeyConflict && (
                        <div className={css.coverageNotice}>
                          {t('toolCitationKeyConflict', {
                            native: row.citationKeyConflict.native,
                            extra: row.citationKeyConflict.extra,
                          })}
                        </div>
                      )}
                      <div className={css.itemActions}>
                        {row.bestAttachmentRef && (
                          <PdfReadButton
                            attachmentRef={row.bestAttachmentRef}
                            onOpenFile={props.openFile}
                            resolveAttachment={client.resolveAttachment}
                            label={t('readPdf')}
                            t={t}
                            variant="link"
                            className={linkCss.linkDense}
                          />
                        )}
                        <ZoteroLocateActions
                          title={row.title}
                          itemRef={row.ref}
                          t={t}
                          variant="link"
                          className={linkCss.linkDense}
                          openProtocol={client.openProtocol}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {omitted > 0 && (
                  <div className={css.coverageNotice}>
                    {t('omittedRowsNote', { count: omitted })}
                  </div>
                )}
              </>
            ) : rawText ? (
              <RawTextFallback text={rawText} copyLabel={t('copy')} copiedLabel={t('copied')} />
            ) : (
              <div className={css.coverageNotice}>{t('toolNoResults')}</div>
            )}
          </>
        )
      }}
    </ZoteroToolRow>
  )
}
