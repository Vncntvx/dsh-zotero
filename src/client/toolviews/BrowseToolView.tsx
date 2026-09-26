/**
 * Dedicated toolview cards for browsing and sync:
 * `zotero_browse` and `zotero_changes`.
 * @module dsh-zotero/client/toolviews/BrowseToolView
 */

import { useMemo } from 'react'
import {
  IconBrowseOutlineRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  argsOf,
  errorSummaryOf,
  isRecord,
  metaOf,
  resultTextOf,
  stringField,
} from '../presenters.ts'
import { RawTextFallback, RunningNotice, ZoteroToolRow } from './ZoteroToolRow.tsx'
import css from './toolviews.module.css'

export type BrowseToolViewProps = PropsRuntime<
  'tool.call.toolview',
  'zotero_browse' | 'zotero_changes'
> &
  PropsLocale<'zotero'>

export function BrowseToolView(props: BrowseToolViewProps) {
  const { toolName, block, useDisclosure, inspect, t } = props

  const isChanges = toolName === 'zotero_changes'
  const icon = isChanges ? (
    <IconRefreshOutlineRegular size={14} />
  ) : (
    <IconBrowseOutlineRegular size={14} />
  )
  const title = isChanges ? t('toolTitleChanges') : t('toolTitleBrowse')

  const { summary, errorSummary, rawText } = useMemo(() => {
    const raw = (resultTextOf(block) ?? '').trim()
    const errSummary = errorSummaryOf(block, raw)

    let sum = ''
    if ('phase' in block && block.phase === 'start') {
      sum = t('toolRunning')
    } else if (isChanges) {
      const meta = metaOf(block)
      let count = 0
      let hasCount = false
      if (meta && isRecord(meta['totals'])) {
        for (const val of Object.values(meta['totals'])) {
          if (typeof val === 'number') {
            count += val
            hasCount = true
          }
        }
      }
      sum = hasCount ? t('toolSummaryChanges', { count }) : t('toolTitleChanges')
    } else {
      const args = argsOf(block)
      const category = stringField(args ?? {}, 'category') ?? 'items'
      const lineCount = raw ? raw.split('\n').filter(Boolean).length : 0
      sum = t('toolSummaryBrowse', { category, count: lineCount })
    }

    return {
      summary: sum,
      errorSummary: errSummary,
      rawText: raw,
    }
  }, [block, isChanges, t])

  return (
    <ZoteroToolRow
      toolName={toolName}
      block={block}
      useDisclosure={useDisclosure}
      inspect={inspect}
      t={t}
      icon={icon}
      title={title}
      summary={summary}
      errorSummary={errorSummary}
    >
      {({ isRunning }) => {
        if (isRunning) {
          return <RunningNotice text={t('toolRunning')} />
        }
        if (rawText) {
          return <RawTextFallback text={rawText} />
        }
        return <div className={css.coverageNotice}>{t('toolNoResults')}</div>
      }}
    </ZoteroToolRow>
  )
}
