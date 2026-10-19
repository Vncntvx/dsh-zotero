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
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroStatusView } from '../contract.ts'
import { DiagnosisBox } from './components/DiagnosisBox.tsx'
import { useZoteroProbe } from './components/useZoteroProbe.ts'
import { writeStatusLabel } from './components/write-label.ts'
// Type-only: the `SessionProjectionMap` entry that makes
// `useProjection('zoteroStatus')` resolve. The merge lives in a
// dependency-free host module the client graph admits.
import type {} from '../projection-keys.ts'

import { formatCommandLine } from './zotero-command-input.ts'
import css from './ZoteroCommandCard.module.css'

/**
 * The inject face this card declares: the translate function plus the optional
 * live probe. The projected snapshot is *not* a face member — it arrives with
 * the slot's standard kit (`useProjection`), so a composition without the
 * projection registry still renders the card with the probe and the command
 * text as its only sources.
 */
export interface ZoteroCommandCardFace {
  readonly t: TranslateNS<'zotero'>
  readonly probe?: () => Promise<RemoteResult<ZoteroStatusView>>
}

export type ZoteroCommandCardProps = PropsRuntime<'conversation.chat.commandview'> &
  ZoteroCommandCardFace

/**
 * Dedicated result card for `/zotero` command invocations.
 *
 * Structured facts come from the `zoteroStatus` session projection the host
 * half registers and the command handler points at with `sourceEventSeq`; the
 * command text is rendered verbatim as the human answer and is never parsed.
 * A live re-probe outranks the projection, because it is the newer answer, and
 * a session that never ran the command simply has no projection.
 *
 * `useProjection` arrives with the slot's standard kit rather than through
 * {@link ZoteroCommandCardFace}, and its three answers degrade in order:
 * `undefined` means the composition has no projection registry at all (the
 * host unit unmounted), `null` means the session never recorded a probe, and a
 * view is a real snapshot. Neither of the first two is a fact source — the card
 * falls back to the live probe, then to the command text — and all three are
 * exercised by `tests/client/zotero-command-card.spec.tsx`.
 */
export function ZoteroCommandCard({
  node,
  t,
  probe,
  useProjection,
}: ZoteroCommandCardProps): ReactNode {
  const [expanded, setExpanded] = useState(false)
  const { state: probeState, runProbe } = useZoteroProbe(probe)

  // The projected snapshot the handler logged for this run. `undefined` or `null`
  // when this session never recorded one (or the composition has no projection
  // registry), which the card treats as "no facts beyond the live probe".
  const projected = useProjection('zoteroStatus')

  const outcome = node.outcome
  const isRunning = outcome === null
  const isError = outcome?.kind === 'error'
  const rawText = outcome?.text ?? ''

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

  const effectiveStatus = useMemo(() => {
    const raw = probeState.data ?? projected
    return {
      connected:
        probeState.data !== undefined
          ? probeState.data.connected
          : probeState.error !== undefined
            ? false
            : projected?.connected === true,
      endpoint: raw?.endpoint,
      version: raw?.zoteroVersion,
      apiVersion: raw?.apiVersion,
      schemaVersion: raw?.schemaVersion,
      serverId: raw?.serverId,
      serverIdUnreported:
        probeState.data !== undefined
          ? probeState.data.serverId === undefined
          : probeState.error === undefined && projected != null && projected.serverId === undefined,
      write: raw?.write,
      diagnosis: probeState.error ?? probeState.data?.diagnosis ?? projected?.diagnosis,
    }
  }, [probeState.data, probeState.error, projected])

  // One settled answer is the only fact source: a live probe that answered, or
  // a projection this session recorded. `projected` is undefined when the
  // composition has no projection registry, and null when the session never
  // ran the command; neither counts.
  const hasFacts = probeState.data !== undefined || projected != null

  const headerPrefix = useMemo(() => {
    let dotClass = css.dotGreen
    if (probeState.loading) {
      dotClass = css.dotYellow
    } else if (isRunning) {
      dotClass = css.dotYellow
    } else if (isError || !effectiveStatus.connected) {
      dotClass = css.dotRed
    }

    return (
      <span className={css.summaryBadge}>
        <span className={dotClass} aria-hidden>
          ●
        </span>
      </span>
    )
  }, [probeState.loading, isRunning, isError, effectiveStatus.connected])

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

    if (hasFacts) {
      const summaryText = effectiveStatus.connected
        ? `${effectiveStatus.version ?? t('badgeSuccess')}`
        : `${effectiveStatus.diagnosis ?? t('statusUnavailable')}`
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
    hasFacts,
    effectiveStatus.connected,
    effectiveStatus.version,
    effectiveStatus.diagnosis,
    rawText,
    t,
  ])

  const writeDisplay = useMemo(
    () => writeStatusLabel(effectiveStatus.write, t),
    [effectiveStatus.write, t],
  )

  const expandable = !isRunning && (hasFacts || rawText !== '')
  const open = expanded && expandable

  const body = useMemo(() => {
    if (!open) return null

    // The re-probe action sits outside the fact branch on purpose: a card that
    // expanded to raw text (an errored command, or a session that logged no
    // snapshot) is exactly the case where a user most wants to try again, and
    // it used to be the one view with no way to.
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
      effectiveStatus.endpoint === undefined ? null : (
        <div className={css.cardItem}>
          <span className={css.itemLabel}>{t('statusLocalApiAddress')}</span>
          <span className={css.itemValue}>{effectiveStatus.endpoint}</span>
        </div>
      )

    if (
      !hasFacts ||
      (isError && node.outcome?.sourceEventSeq === undefined && probeState.data === undefined)
    ) {
      return (
        <div className={css.bodyWrap}>
          <pre className={css.errorBody}>{rawText}</pre>
          {actions}
        </div>
      )
    }

    return (
      <div className={css.bodyWrap} data-zotero-command-card-body>
        {effectiveStatus.connected ? (
          <div className={css.cardGrid}>
            {endpointRow}
            <div className={css.cardItem}>
              <span className={css.itemLabel}>{t('zoteroVersionLabel')}</span>
              <span className={css.itemValue}>{effectiveStatus.version ?? '-'}</span>
            </div>
            <div className={css.cardItem}>
              <span className={css.itemLabel}>{t('apiVersionLabel')}</span>
              <span className={css.itemValue}>
                {effectiveStatus.apiVersion ?? '-'}
                {effectiveStatus.schemaVersion !== undefined
                  ? ` (${t('schemaVersionLabel')}: ${effectiveStatus.schemaVersion})`
                  : ''}
              </span>
            </div>
            <div className={css.cardItem}>
              <span className={css.itemLabel}>{t('serverIdLabel')}</span>
              <span className={css.itemValue}>
                {effectiveStatus.serverId ??
                  (effectiveStatus.serverIdUnreported ? t('statusServerIdUnreported') : '-')}
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
            {effectiveStatus.diagnosis && (
              <DiagnosisBox diagnosis={effectiveStatus.diagnosis} t={t} />
            )}
          </div>
        )}

        {actions}
      </div>
    )
  }, [
    open,
    hasFacts,
    isError,
    node.outcome?.sourceEventSeq,
    effectiveStatus,
    writeDisplay,
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
