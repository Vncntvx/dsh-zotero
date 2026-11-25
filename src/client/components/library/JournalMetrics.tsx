import { IconRefreshOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroJournalMetricsView } from '../../../contract.ts'
import {
  journalMetricListValues,
  type JournalMetricDetailField,
  type JournalMetricListRules,
} from '../../../journal-metrics.ts'
import {
  journalMetricFailureLabels,
  journalMetricLabel,
  journalMetricSummaryLabel,
} from '../../journal-metric-labels.ts'
import { IconButton } from '../IconButton.tsx'
import css from './library.module.css'

type T = TranslateNS<'zotero'>

export function JournalMetricsSummary({
  t,
  result,
  order,
  compact,
}: {
  t: T
  result?: ZoteroJournalMetricsView
  order: JournalMetricListRules
  compact: boolean
}) {
  if (result?.status !== 'ready') return null
  const summary = journalMetricListValues(result.official, order, compact)
  if (!summary.length) return null
  return (
    <span className={css.journalSummary}>
      {summary.map(({ field, value }) => {
        const text = `${journalMetricSummaryLabel(field, t)} ${value}`
        return (
          <span key={field} className={css.journalSummaryValue} title={text}>
            {text}
          </span>
        )
      })}
    </span>
  )
}

export function journalMetricDetailRows({
  t,
  result,
  fields,
  retry,
  retrying,
  Row,
}: {
  t: T
  result?: ZoteroJournalMetricsView
  fields: readonly JournalMetricDetailField[]
  retry: () => void
  retrying: boolean
  Row: ComponentType<{ label: string; value: ReactNode; actions?: ReactNode }>
}) {
  const ready = result?.status === 'ready' ? result : undefined
  const status = ready ? ready.refreshFailure : result?.status
  const byField = new Map(ready?.official.map(({ field, value }) => [field, value]))
  const official = fields.flatMap((field) => {
    const value = field === 'custom' ? undefined : byField.get(field)
    return value === undefined ? [] : [{ field, value }]
  })
  const custom = fields.includes('custom') ? (ready?.custom ?? []) : []
  const issue = status && status !== 'disabled' && status !== 'ready' ? status : undefined
  const canRetry = issue !== undefined && issue !== 'credential' && issue !== 'requestRejected'
  if (!official.length && !custom.length && !issue) return null
  return (
    <>
      {official.map(({ field, value }) => (
        <Row key={field} label={journalMetricLabel(field, t)} value={value} />
      ))}
      {custom.map(({ id, label, value }) => (
        <Row key={`custom:${id}`} label={label} value={value} />
      ))}
      {issue && (
        <Row
          label={t('journalMetrics')}
          value={<span role="status">{t(journalMetricFailureLabels[issue])}</span>}
          actions={
            canRetry ? (
              <Tooltip label={t('journalMetricsRetry')} side="bottom" delayMs={500} portal>
                <IconButton
                  size="sm"
                  icon={<IconRefreshOutlineRegular size={12} />}
                  aria-label={t('journalMetricsRetry')}
                  disabled={retrying}
                  onClick={retry}
                />
              </Tooltip>
            ) : undefined
          }
        />
      )}
    </>
  )
}
