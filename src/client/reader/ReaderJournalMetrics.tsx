import { useCallback, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroRemoteContract } from '../../contract.ts'
import { journalMetricDetailRows } from '../components/library/JournalMetrics.tsx'
import { useJournalMetrics } from '../components/library/useJournalMetrics.ts'
import {
  useLibraryPreferenceSource,
  type LibraryPreferenceSource,
} from '../library-preferences.tsx'
import css from './reader.module.css'

export interface ReaderJournalMetricsOptions {
  readonly preferences: LibraryPreferenceSource
  readonly read: ZoteroRemoteContract['journalMetrics']
  readonly translate: TranslateNS<'zotero'>
}

function MetricRow({
  label,
  value,
  actions,
}: {
  label: string
  value: ReactNode
  actions?: ReactNode
}) {
  return (
    <>
      <dt className={css.detailsTerm}>{label}</dt>
      <dd className={css.detailsValue}>
        {value}
        {actions}
      </dd>
    </>
  )
}

interface MetricsProps extends PropsLocale<'zoteroReader'> {
  readonly options: ReaderJournalMetricsOptions
  readonly journal: string
  readonly tabSignal: AbortSignal
}

export function ReaderJournalMetrics({ options, ...props }: MetricsProps) {
  const settings = useLibraryPreferenceSource(options.preferences)
  const preferences = settings.preferences
  if (!preferences?.journalMetricsEnabled || preferences.journalMetricDetailFields.length === 0)
    return null
  const credential = `${preferences.easyScholarSecretKeyRef}:${settings.journalCredentialRevision ?? 0}`
  return (
    <JournalLookup
      key={JSON.stringify([props.journal, credential])}
      {...props}
      options={options}
      fields={preferences.journalMetricDetailFields}
      credential={credential}
      refreshRevision={settings.journalRefreshRevision ?? 0}
    />
  )
}

const ignoreNotice = () => {}

function JournalLookup({
  t,
  journal,
  options,
  tabSignal,
  fields,
  credential,
  refreshRevision,
}: MetricsProps & {
  readonly fields: Parameters<typeof journalMetricDetailRows>[0]['fields']
  readonly credential: string
  readonly refreshRevision: number
}) {
  const [requested, setRequested] = useState(false)
  const read = useCallback<ZoteroRemoteContract['journalMetrics']>(
    (request, signal) => {
      const combined = signal ? AbortSignal.any([tabSignal, signal]) : tabSignal
      combined.throwIfAborted()
      return options.read(request, combined)
    },
    [options, tabSignal],
  )
  const metrics = useJournalMetrics(
    requested ? read : undefined,
    credential,
    refreshRevision,
    fields.join(','),
    undefined,
    journal,
    ignoreNotice,
  )
  if (!requested)
    return (
      <Button size="sm" onClick={() => setRequested(true)}>
        {t('detailsLoadMetrics')}
      </Button>
    )
  const result = metrics.forJournal(journal)
  const rows = journalMetricDetailRows({
    t: options.translate,
    result,
    fields,
    retry: metrics.retry,
    retrying: metrics.retrying,
    Row: MetricRow,
  })
  return rows ? (
    <dl aria-label={options.translate('journalMetrics')}>{rows}</dl>
  ) : (
    <p role="status">{t(result ? 'detailsMetricsEmpty' : 'detailsMetricsLoading')}</p>
  )
}
