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
import { parseZoteroStatusText, type ParsedZoteroStatus } from './status-parser.ts'
import { formatCommandLine } from './zotero-command-input.ts'
import css from './ZoteroCommandCard.module.css'

export interface ZoteroCommandCardProps extends CommandRowOwnerProps {
  readonly t: TranslateNS<'zotero'>
  readonly probe?: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * The status facts a live probe and the parsed command text both carry, and so
 * the ones that can be swapped between them. `ParsedZoteroStatus` adds
 * `serverIdUnreported` and `rawText`, and `ZoteroStatusView` adds
 * `providerId`; neither is a probe-vs-text choice, since one is derived (below)
 * and the other identifies the source.
 */
type SharedStatusKey =
  'connected' | 'endpoint' | 'zoteroVersion' | 'apiVersion' | 'schemaVersion' | 'serverId' | 'write'

/** One fact, from whichever source won. */
type SharedStatusFact<K extends SharedStatusKey> =
  ZoteroStatusView[K] | ParsedZoteroStatus[K] | undefined

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

  // `DisclosureRow` is memo'd on shallow-equal props, so the toggle callback
  // has to be stable: an inline arrow would defeat the memo on every parent
  // re-render and re-render the whole card for nothing.
  const handleToggle = useCallback((): void => {
    setExpanded((prev) => !prev)
  }, [])

  const title = useMemo(() => formatCommandLine(node.name, node.args), [node.name, node.args])

  /**
   * Read one status field, preferring a live probe over the parsed command text.
   *
   * The gate is "did the probe answer", *not* "is there an error": a probe that
   * reaches Zotero and is told it is offline sets **both** `data` and `error`,
   * and that answer still carries the address it dialled, the one
   * fact worth reading on a disconnected card. Gating on `error` would drop
   * the row exactly when the user clicked Refresh to find out what was wrong.
   * A probe that failed outright (no `data`) has no facts to prefer, so the
   * parsed text stands.
   *
   * @param key - the status field to read.
   * @param fallback - the parsed-text value, used when no probe has answered.
   * @returns the probe's value, the parsed value, or undefined.
   */
  const effective = <K extends SharedStatusKey>(
    key: K,
    fallback: ParsedZoteroStatus[K] | undefined,
  ): SharedStatusFact<K> =>
    probeState.data !== undefined
      ? probeState.data[key]
      : probeState.error === undefined
        ? fallback
        : undefined

  const effectiveConnected = effective('connected', parsed?.connected) === true
  // The dialled endpoint, not a configured default: the probe reports the
  // address it actually reached, which is the one to check when it failed.
  const effectiveEndpoint = effective('endpoint', parsed?.endpoint)
  const effectiveVersion = effective('zoteroVersion', parsed?.zoteroVersion)
  const effectiveApiVersion = effective('apiVersion', parsed?.apiVersion)
  const effectiveSchemaVersion = effective('schemaVersion', parsed?.schemaVersion)
  const effectiveServerId = effective('serverId', parsed?.serverId)
  const effectiveWrite = effective('write', parsed?.write)
  // "Unreported" is the absence of an id. When a probe won, that is the probe's
  // own undefined `serverId`; a failed probe has no id to report at all, and
  // only the parsed text carries the flag. A plain boolean, not a memoized
  // callback: it is read once, below.
  const effectiveServerIdUnreported =
    probeState.data !== undefined
      ? probeState.data.serverId === undefined
      : probeState.error === undefined && (parsed?.serverIdUnreported ?? false)
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

    // The re-probe action sits outside the parsed branch on purpose: a card
    // that expanded to raw text (an errored command, or output this version
    // does not recognize) is exactly the case where a user most wants to try
    // again, and it used to be the one view with no way to.
    const actions =
      probe === undefined ? null : (
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
      )

    // The endpoint is the one row that shows offline too: when the probe
    // failed, the address that did not answer is the fact. One element, both
    // arms, so a later edit cannot land in one branch and not the other.
    const endpointRow =
      effectiveEndpoint === undefined ? null : (
        <div className={css.cardItem}>
          <span className={css.itemLabel}>{t('statusLocalApiAddress')}</span>
          <span className={css.itemValue}>{effectiveEndpoint}</span>
        </div>
      )

    if (!parsed) {
      return (
        <div className={css.bodyWrap}>
          <pre className={css.errorBody}>{rawText}</pre>
          {actions}
        </div>
      )
    }

    return (
      <div className={css.bodyWrap} data-zotero-command-card-body>
        {effectiveConnected ? (
          <div className={css.cardGrid}>
            {endpointRow}
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
          <div className={css.cardGrid}>
            {endpointRow}
            {effectiveDiagnosis && <DiagnosisBox diagnosis={effectiveDiagnosis} t={t} />}
          </div>
        )}

        {actions}
      </div>
    )
  }, [
    open,
    parsed,
    effectiveConnected,
    effectiveEndpoint,
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
        onToggle={handleToggle}
        icon={headerPrefix}
        title={title}
        collapsedContent={headerSummary}
      >
        {body}
      </DisclosureRow>
    </div>
  )
}
