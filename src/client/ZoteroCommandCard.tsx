/**
 * Dedicated Slash command result card for `/zotero` (conversation.chat.commandview slot).
 *
 * Renders connection status, metrics (Zotero version, API/schema version,
 * database Server ID, write state), diagnosis details, and an inline live
 * probe action.
 * @module dsh-zotero/client/ZoteroCommandCard
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { DisclosureRow, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommandRowOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroStatusView } from '../contract.ts'
import { DiagnosisBox } from './components/DiagnosisBox.tsx'
import { useZoteroProbe } from './components/useZoteroProbe.ts'
import { writeStatusLabel } from './components/write-label.ts'
import { parseZoteroStatusText } from './status-parser.ts'
import { formatCommandLine } from './zotero-command-input.ts'
import css from './ZoteroCommandCard.module.css'

export interface ZoteroCommandCardProps extends CommandRowOwnerProps {
  readonly t: TranslateNS<'zotero'>
  readonly probe?: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * Dedicated result card for `/zotero` command invocations.
 */
export function ZoteroCommandCard({ node, t, probe }: ZoteroCommandCardProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const { state: probeState, runProbe } = useZoteroProbe(probe)

  const outcome = node.outcome
  const isRunning = outcome === null
  const isError = outcome?.kind === 'error'
  const rawText = outcome?.text ?? ''

  const parsed = useMemo(() => parseZoteroStatusText(rawText), [rawText])

  const handleRecheck = useCallback(
    (e: React.MouseEvent): void => {
      e.stopPropagation()
      void runProbe()
    },
    [runProbe],
  )

  const title = useMemo(() => formatCommandLine(node.name, node.args), [node.name, node.args])

  const effectiveConnected =
    probeState.error !== undefined
      ? false
      : probeState.data !== undefined
        ? probeState.data.connected
        : (parsed?.connected ?? false)
  const effectiveVersion =
    probeState.error !== undefined
      ? undefined
      : probeState.data !== undefined
        ? probeState.data.zoteroVersion
        : parsed?.zoteroVersion
  const effectiveApiVersion =
    probeState.error !== undefined
      ? undefined
      : probeState.data !== undefined
        ? probeState.data.apiVersion
        : parsed?.apiVersion
  const effectiveSchemaVersion =
    probeState.error !== undefined
      ? undefined
      : probeState.data !== undefined
        ? probeState.data.schemaVersion
        : parsed?.schemaVersion
  const effectiveServerId =
    probeState.error !== undefined
      ? undefined
      : probeState.data !== undefined
        ? probeState.data.serverId
        : parsed?.serverId
  const effectiveServerIdUnreported =
    probeState.error !== undefined
      ? false
      : probeState.data !== undefined
        ? probeState.data.serverId === undefined
        : parsed?.serverIdUnreported
  const effectiveWrite =
    probeState.error !== undefined
      ? undefined
      : probeState.data !== undefined
        ? probeState.data.write
        : parsed?.write
  const effectiveDiagnosis = probeState.error ?? probeState.data?.diagnosis ?? parsed?.diagnosis

  const headerPrefix = useMemo(() => {
    let dotClass = css.dotGreen
    if (probeState.loading) {
      dotClass = css.dotYellow
    } else if (isRunning) {
      dotClass = css.dotYellow
    } else if (isError || !effectiveConnected) {
      dotClass = css.dotRed
    }

    return (
      <span className={css.summaryBadge}>
        <span className={dotClass} aria-hidden>
          ●
        </span>
      </span>
    )
  }, [probeState.loading, isRunning, isError, effectiveConnected])

  const headerSummary = useMemo(() => {
    if (isRunning) {
      return (
        <>
          <span className={css.summarySep} aria-hidden />
          <span className={css.summary}>{t('commandChecking')}</span>
        </>
      )
    }

    if (isError) {
      return (
        <>
          <span className={css.summarySep} aria-hidden />
          <span className={css.summary} data-error="true">
            {t('commandFailed')}
          </span>
        </>
      )
    }

    if (parsed) {
      const summaryText = effectiveConnected
        ? `${effectiveVersion ?? t('badgeSuccess')}`
        : `${effectiveDiagnosis ?? t('statusUnavailable')}`
      return (
        <>
          <span className={css.summarySep} aria-hidden />
          <span className={css.summary}>{summaryText}</span>
        </>
      )
    }

    return (
      <>
        <span className={css.summarySep} aria-hidden />
        <span className={css.summary}>{rawText}</span>
      </>
    )
  }, [
    isRunning,
    isError,
    parsed,
    effectiveConnected,
    effectiveVersion,
    effectiveDiagnosis,
    rawText,
    t,
  ])

  const writeDisplay = useMemo(() => writeStatusLabel(effectiveWrite, t), [effectiveWrite, t])

  const expandable = !isRunning && (parsed !== null || rawText !== '')
  const open = expanded && expandable

  const body = useMemo(() => {
    if (!open) return null

    if (parsed) {
      return (
        <div className={css.bodyWrap} data-zotero-command-card-body>
          {effectiveConnected ? (
            <div className={css.cardGrid}>
              <div className={css.cardItem}>
                <span className={css.itemLabel}>{t('statusLocalApiAddress')}</span>
                <span className={css.itemValue}>127.0.0.1:23119</span>
              </div>
              <div className={css.cardItem}>
                <span className={css.itemLabel}>{t('zoteroVersionLabel')}</span>
                <span className={css.itemValue}>{effectiveVersion ?? '-'}</span>
              </div>
              <div className={css.cardItem}>
                <span className={css.itemLabel}>{t('apiVersionLabel')}</span>
                <span className={css.itemValue}>
                  {effectiveApiVersion ?? '-'}
                  {effectiveSchemaVersion !== undefined
                    ? ` (${t('schemaVersionLabel')}: ${effectiveSchemaVersion})`
                    : ''}
                </span>
              </div>
              <div className={css.cardItem}>
                <span className={css.itemLabel}>{t('serverIdLabel')}</span>
                <span className={css.itemValue}>
                  {effectiveServerId ??
                    (effectiveServerIdUnreported ? t('statusServerIdUnreported') : '-')}
                </span>
              </div>
              <div className={css.cardItem}>
                <span className={css.itemLabel}>{t('writeLabel')}</span>
                <span className={css.itemValue}>{writeDisplay}</span>
              </div>
            </div>
          ) : (
            effectiveDiagnosis && <DiagnosisBox diagnosis={effectiveDiagnosis} t={t} />
          )}

          {probe ? (
            <div className={css.actionsRow}>
              <button
                type="button"
                className={css.actionButton}
                disabled={probeState.loading}
                onClick={handleRecheck}
              >
                <IconRefreshOutlineRegular size={12} />
                <span>{probeState.loading ? t('checking') : t('refresh')}</span>
              </button>
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <div className={css.bodyWrap}>
        <pre className={css.errorBody}>{rawText}</pre>
      </div>
    )
  }, [
    open,
    parsed,
    effectiveConnected,
    effectiveVersion,
    effectiveApiVersion,
    effectiveSchemaVersion,
    effectiveServerId,
    effectiveServerIdUnreported,
    writeDisplay,
    effectiveDiagnosis,
    probe,
    probeState.loading,
    handleRecheck,
    rawText,
    t,
  ])

  return (
    <div className={css.root} data-zotero-command-card>
      <DisclosureRow
        open={open}
        expandable={expandable}
        running={isRunning || probeState.loading}
        expandOnRowClick
        onToggle={() => setExpanded((prev) => !prev)}
        icon={headerPrefix}
        title={title}
        collapsedContent={headerSummary}
      >
        {body}
      </DisclosureRow>
    </div>
  )
}
