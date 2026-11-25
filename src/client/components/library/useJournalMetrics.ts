import { useEffect, useRef, useState } from 'react'
import type {
  ZoteroRemoteContract,
  ZoteroJournalMetricsFailure,
  ZoteroJournalMetricsView,
  ZoteroSearchItemView,
} from '../../../contract.ts'

type Lookup = ZoteroRemoteContract['journalMetrics']
export type JournalMetricsNotice = 'journalMetricsCredential' | 'journalMetricsQuotaExceeded'
const UNAVAILABLE = { status: 'unavailable' } as const

async function lookup(
  read: Lookup,
  publicationName: string,
  priority: 'list' | 'detail',
  signal: AbortSignal,
): Promise<ZoteroJournalMetricsView> {
  try {
    const result = await read({ publicationName, priority }, signal)
    return result.ok ? result.value : UNAVAILABLE
  } catch {
    return UNAVAILABLE
  }
}

interface PageMetrics {
  readonly scope: string
  readonly values: ReadonlyMap<string, ZoteroJournalMetricsView>
}
const EMPTY = new Map<string, ZoteroJournalMetricsView>()

/** The list and inspector track separate results; the host shares one request per journal. */
export function useJournalMetrics(
  read: Lookup | undefined,
  credentialGeneration: string,
  refreshRevision: number,
  requestedFields: string,
  items: readonly ZoteroSearchItemView[] | undefined,
  selectedJournal: string | undefined,
  notify: (notice: JournalMetricsNotice) => void,
) {
  const names = [
    ...new Set(
      items?.flatMap(({ publicationTitle }) => (publicationTitle ? [publicationTitle] : [])),
    ),
  ]
  const page = JSON.stringify(names)
  const [results, setResults] = useState<PageMetrics>()
  const [detail, setDetail] = useState<{
    scope: string
    attempt: number
    value: ZoteroJournalMetricsView
  }>()
  const [retry, setRetry] = useState<{ scope: string; attempt: number }>()
  const [incremental, setIncremental] = useState(0)
  const scope = JSON.stringify([credentialGeneration, refreshRevision, page])
  const detailScope = JSON.stringify([credentialGeneration, refreshRevision, selectedJournal])
  const attempt = retry?.scope === detailScope ? retry.attempt : 0
  const settled = useRef({ results, detail })
  const previousFields = useRef(requestedFields)

  useEffect(() => {
    settled.current = { results, detail }
  }, [results, detail])

  useEffect(() => {
    const previous = previousFields.current.split(',')
    previousFields.current = requestedFields
    if (!requestedFields.split(',').some((field) => field && !previous.includes(field))) return
    const { results, detail } = settled.current
    if (
      (detail?.scope === detailScope && detail.value.status !== 'ready') ||
      (results?.scope === scope &&
        [...results.values.values()].some((value) => value.status !== 'ready'))
    ) {
      setIncremental((value) => value + 1)
    }
  }, [requestedFields, scope, detailScope])

  useEffect(() => {
    if (read) return
    setResults(undefined)
    setDetail(undefined)
  }, [read])

  useEffect(() => {
    if (!read) return
    const previous = settled.current.results
    const names = (JSON.parse(page) as string[]).filter(
      (name) => previous?.scope !== scope || previous.values.get(name)?.status !== 'ready',
    )
    const controller = new AbortController()
    const { signal } = controller
    let index = 0
    let blocked = false
    const consume = async () => {
      while (!signal.aborted && !blocked) {
        const name = names[index++]
        if (name === undefined) return
        const value = await lookup(read, name, 'list', signal)
        if (signal.aborted) return
        if (value.status === 'credential' || value.status === 'disabled') blocked = true
        setResults((previous) => {
          const values = new Map(previous?.scope === scope ? previous.values : undefined)
          values.set(name, value)
          return { scope, values }
        })
      }
    }
    for (let worker = 0; worker < 2; worker++) void consume()
    return () => controller.abort()
  }, [read, page, scope, incremental])

  useEffect(() => {
    if (!read || selectedJournal === undefined) return
    const previous = settled.current.detail
    if (
      previous?.scope === detailScope &&
      previous.attempt === attempt &&
      previous.value.status === 'ready'
    )
      return
    const controller = new AbortController()
    void lookup(read, selectedJournal, 'detail', controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setDetail({ scope: detailScope, attempt, value })
      if (value.status === 'ready') {
        setResults((previous) => {
          if (previous?.scope !== scope || !previous.values.has(selectedJournal)) return previous
          return { scope, values: new Map(previous.values).set(selectedJournal, value) }
        })
      }
    })
    return () => controller.abort()
  }, [read, selectedJournal, detailScope, attempt, scope, incremental])

  const pageValues = read && results?.scope === scope ? results.values : EMPTY
  const selectedValue = read && detail?.scope === detailScope ? detail.value : undefined
  const listValue = selectedJournal === undefined ? undefined : pageValues.get(selectedJournal)
  const selected =
    selectedValue?.status === 'ready'
      ? selectedValue
      : listValue?.status === 'ready'
        ? listValue
        : (selectedValue ?? listValue)
  const values = [...pageValues.values()]
  const matchesStatus = (
    value: ZoteroJournalMetricsView | undefined,
    status: ZoteroJournalMetricsFailure,
  ) => (value?.status === 'ready' ? value.refreshFailure : value?.status) === status
  const hasFailure = (status: ZoteroJournalMetricsFailure) =>
    matchesStatus(selected, status) || values.some((value) => matchesStatus(value, status))
  const credentialError = hasFailure('credential')
  const quotaExceeded = hasFailure('quotaExceeded')
  const notice = credentialError
    ? 'journalMetricsCredential'
    : quotaExceeded
      ? 'journalMetricsQuotaExceeded'
      : undefined
  // Results for a page and its inspector can settle in separate renders.
  const notified = useRef(new Set<JournalMetricsNotice>())
  useEffect(() => {
    notified.current.clear()
  }, [credentialGeneration])
  useEffect(() => {
    if (!notice || notified.current.has(notice)) return
    notified.current.add(notice)
    notify(notice)
  }, [credentialGeneration, notice, notify])

  return {
    forJournal: (name: string | undefined) =>
      name === undefined ? undefined : name === selectedJournal ? selected : pageValues.get(name),
    retrying: attempt > 0 && (detail?.scope !== detailScope || detail.attempt !== attempt),
    retry: () => {
      if (selectedJournal !== undefined) setRetry({ scope: detailScope, attempt: attempt + 1 })
    },
  }
}
