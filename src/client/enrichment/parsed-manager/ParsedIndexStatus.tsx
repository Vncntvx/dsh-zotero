import { useEffect, useRef, useState } from 'react'
import {
  IconRefreshOutlineRegular,
  IconStopFillRegular,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ZoteroDocumentMaintenanceRemote,
  ZoteroParsedIndexStatusView,
} from '../../../contract.ts'
import { messageOf } from '../../error-text.ts'
import { IconButton } from '../../components/IconButton.tsx'
import { typedRemoteResult, type DocumentParseJobs } from '../parse-controller.ts'
import css from '../parsed-manager.module.css'

interface Props {
  remote: ZoteroDocumentMaintenanceRemote
  jobs: DocumentParseJobs
  sessionId: string
  revision: number
  rebuildAllowed: boolean
  cancelAllowed: boolean
  connected: boolean
  notify(text: string, tone?: 'success'): void
  t: TranslateNS<'zotero'>
}

export function ParsedIndexStatus({
  remote,
  jobs,
  sessionId,
  revision,
  rebuildAllowed,
  cancelAllowed,
  connected,
  notify,
  t,
}: Props) {
  const [status, setStatus] = useState<ZoteroParsedIndexStatusView>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const requestedJob = useRef<string>()
  useEffect(() => {
    if (!connected) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = typedRemoteResult(
          await remote.parsedIndexStatus({ sessionId }, abort.signal),
        )
        if (abort.signal.aborted) return
        setStatus(result)
        setError(undefined)
        if (
          result.progress ||
          result.rebuild?.state === 'running' ||
          result.rebuild?.state === 'stopping'
        )
          timer = setTimeout(() => void read(), 1500)
      } catch (cause) {
        if (!abort.signal.aborted) setError(messageOf(cause))
      }
    }
    void read()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [remote, sessionId, revision, refresh, connected])

  const rebuild = status?.rebuild
  const progress = status?.progress
  const waiting = rebuild?.state === 'running'
  const stopping = rebuild?.state === 'stopping'
  const active = !!progress || waiting || stopping
  useEffect(() => {
    if (!rebuild || rebuild.jobId !== requestedJob.current || active) return
    requestedJob.current = undefined
    if (rebuild.state === 'completed') notify(t('indexRebuilt'), 'success')
    if (rebuild.state === 'cancelled') notify(t('indexCancelled'))
  }, [active, notify, rebuild, t])

  const problem = error ?? rebuild?.error
  const remaining = status ? status.total - status.indexed : 0
  const hasDocuments = !!(status && (status.total || status.obsolete || status.unreadable))
  const ready =
    hasDocuments && status !== undefined && !remaining && !status.unreadable && !status.obsolete
  let summary = t('indexLoading')
  if (!connected) summary = t('indexOffline')
  else if (stopping) summary = t('indexStopping')
  else if (progress) summary = t('indexRunning', progress)
  else if (waiting) summary = t('indexWaiting')
  else if (status) {
    summary = status.total
      ? t('indexCoverage', { indexed: status.indexed, total: status.total })
      : t('indexEmpty')
  } else if (problem) summary = t('indexUnavailable')
  const run = async (action: () => Promise<unknown>) => {
    setPending(true)
    setError(undefined)
    try {
      await action()
      setRefresh((value) => value + 1)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <section aria-label={t('indexLabel')} className={css.indexStatus}>
      <div className={css.listBar}>
        <StateDot
          state={
            connected && active
              ? 'ongoing'
              : problem
                ? 'error'
                : connected && ready
                  ? 'done'
                  : 'idle'
          }
          size={12}
        />
        <span className={css.listBarText} role="status">
          {summary}
        </span>
        {rebuild && waiting && cancelAllowed ? (
          <Tooltip label={t('indexCancel')} delayMs={500} portal>
            <IconButton
              type="button"
              size="sm"
              aria-label={t('indexCancel')}
              icon={<IconStopFillRegular size={12} />}
              disabled={!connected || pending}
              onClick={() =>
                void run(async () => {
                  typedRemoteResult(
                    await jobs.kill(
                      sessionId as Parameters<DocumentParseJobs['kill']>[0],
                      rebuild.jobId as Parameters<DocumentParseJobs['kill']>[1],
                    ),
                  )
                  requestedJob.current = rebuild.jobId
                })
              }
            />
          </Tooltip>
        ) : (
          rebuildAllowed &&
          (hasDocuments || problem) && (
            <Tooltip label={t('indexRebuild')} delayMs={500} portal>
              <IconButton
                type="button"
                size="sm"
                aria-label={t('indexRebuild')}
                icon={<IconRefreshOutlineRegular size={13} />}
                disabled={!connected || pending || active}
                onClick={() =>
                  void run(async () => {
                    const { jobId } = typedRemoteResult(
                      await remote.rebuildParsedIndex({ sessionId }),
                    )
                    requestedJob.current = jobId
                  })
                }
              />
            </Tooltip>
          )
        )}
        {!!status?.unreadable && (
          <span className={css.listBarText}>
            {t('indexUnreadable', { count: status.unreadable })}
          </span>
        )}
        {!!status?.obsolete && (
          <span className={css.listBarText}>{t('indexObsolete', { count: status.obsolete })}</span>
        )}
      </div>
      {problem && (
        <p className={css.error} role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
