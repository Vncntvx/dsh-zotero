/**
 * Data-maintenance section of the plugin manager detail page: it reports the
 * stored session logs this build cannot read and repairs the ones this plugin
 * wrote unmarked.
 *
 * Detection never runs on mount: opening the Plugins page must not walk every
 * stored session: and repair always passes a confirmation layer first: the
 * write rewrites session files on disk and cannot be undone from this panel.
 * Every state the user sees is one of five explicit phases, so "cannot check"
 * never renders as "healthy".
 * @module dsh-zotero/client/components/plugin/ZoteroRemediationSection
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ZoteroRemediationIssue,
  ZoteroRemediationItemResult,
  ZoteroRemediationOutcome,
  ZoteroRemediationReason,
  ZoteroRemediationReport,
  ZoteroRemediationRequest,
  ZoteroRemediationResult,
} from '../../remote.ts'
import { messageOf } from '../../error-text.ts'
import css from './plugin-cards.module.css'

/** Copy key per detected reason; the enum value never reaches the DOM. */
const REASON_KEYS = {
  'unknown-event-vocabulary': 'remediationReasonUnknownVocabulary',
  'format-version-unsupported': 'remediationReasonFormatVersion',
  'artifact-corrupt': 'remediationReasonCorrupt',
  'open-failed': 'remediationReasonOpenFailed',
} as const satisfies Record<ZoteroRemediationReason, string>

/** Copy key per repair outcome. */
const OUTCOME_KEYS = {
  repaired: 'remediationOutcomeRepaired',
  unchanged: 'remediationOutcomeUnchanged',
  refused: 'remediationOutcomeRefused',
  busy: 'remediationOutcomeBusy',
  unsupported: 'remediationOutcomeUnsupported',
  failed: 'remediationOutcomeFailed',
} as const satisfies Record<ZoteroRemediationOutcome, string>

export interface ZoteroRemediationSectionProps {
  readonly t: TranslateNS<'zotero'>
  readonly inspect: () => Promise<RemoteResult<ZoteroRemediationReport>>
  readonly execute: (
    request: ZoteroRemediationRequest,
  ) => Promise<RemoteResult<ZoteroRemediationResult>>
}

/** One repair item: what happened, and the facts the backend measured. */
function ResultRow({
  t,
  item,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly item: ZoteroRemediationItemResult
}): ReactNode {
  return (
    <div className={css.remediationResultItem} data-outcome={item.outcome}>
      <span className={css.remediationResultLabel}>{t(OUTCOME_KEYS[item.outcome])}</span>
      {item.changedRecords === undefined || item.totalRecords === undefined ? null : (
        <span className={css.remediationFact}>
          {t('remediationChangedRecords', {
            changed: item.changedRecords,
            total: item.totalRecords,
          })}
        </span>
      )}
      {item.droppedTailBytes === undefined || item.droppedTailBytes === 0 ? null : (
        <span className={css.remediationFact}>
          {t('remediationDroppedTail', { bytes: item.droppedTailBytes })}
        </span>
      )}
      {item.backupPath === undefined ? null : (
        <span className={css.remediationBackupPath}>
          {t('remediationBackupNotice')} {item.backupPath}
        </span>
      )}
    </div>
  )
}

/** One detected issue: its session, why it cannot be read, and its severity. */
function IssueRow({
  t,
  issue,
}: {
  readonly t: TranslateNS<'zotero'>
  readonly issue: ZoteroRemediationIssue
}): ReactNode {
  return (
    <div className={css.remediationIssueItem}>
      <div className={css.remediationIssueHeader}>
        <span className={css.remediationIssueTitle}>{issue.sessionId}</span>
        <div className={css.remediationIssueBadges}>
          <StateDot state={issue.severity === 'critical' ? 'error' : 'warning'} />
        </div>
      </div>
      <p className={css.remediationIssueDesc}>{t(REASON_KEYS[issue.reason])}</p>
    </div>
  )
}

/** The data-maintenance section body. */
export function ZoteroRemediationSection({
  t,
  inspect,
  execute,
}: ZoteroRemediationSectionProps): ReactNode {
  const [report, setReport] = useState<ZoteroRemediationReport | undefined>(undefined)
  const [result, setResult] = useState<ZoteroRemediationResult | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [scanning, setScanning] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const mounted = useRef(true)

  // Cleanup only: this section never runs a scan on mount.
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    setError(undefined)
    setResult(undefined)
    try {
      const response = await inspect()
      if (!mounted.current) return
      if (response.ok) {
        setReport(response.value)
      } else {
        setReport(undefined)
        setError(response.error.message)
      }
    } catch (cause) {
      if (mounted.current) {
        setReport(undefined)
        setError(messageOf(cause))
      }
    } finally {
      if (mounted.current) setScanning(false)
    }
  }, [inspect])

  const repair = useCallback(
    async (issueIds: readonly string[]) => {
      setRepairing(true)
      setError(undefined)
      try {
        const response = await execute({ issueIds })
        if (!mounted.current) return
        if (!response.ok) {
          setError(response.error.message)
          return
        }
        setResult(response.value)
        const next = await inspect()
        if (mounted.current && next.ok) setReport(next.value)
      } catch (cause) {
        if (mounted.current) setError(messageOf(cause))
      } finally {
        if (mounted.current) {
          setRepairing(false)
          setConfirming(false)
        }
      }
    },
    [execute, inspect],
  )

  const issues = report?.issues ?? []
  const unavailable = report?.capability === 'unavailable'
  const healthy = report !== undefined && !unavailable && issues.length === 0
  const busy = scanning || repairing

  return (
    <div className={css.card} data-zotero-remediation-section>
      <div className={css.cardHead}>
        <span className={css.cardTitle}>{t('remediationSectionTitle')}</span>
        <div className={css.remediationActions}>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              void scan()
            }}
          >
            {scanning ? t('remediationScanning') : t('remediationScan')}
          </Button>
          {/* Visible only before confirmation, so it never carries the
              repairing label: the confirmation layer owns that state. The
              repair action also needs the maintenance seam: without it every
              attempt answers "unsupported". */}
          {issues.length > 0 && !unavailable && !confirming ? (
            <Button
              variant="primary"
              size="sm"
              className={css.remediationRepairButton}
              disabled={busy}
              onClick={() => {
                setConfirming(true)
              }}
            >
              {t('remediationRepair')}
            </Button>
          ) : null}
        </div>
      </div>

      {report === undefined ? null : (
        <div
          className={css.statusRow}
          data-state={unavailable ? 'unavailable' : healthy ? 'connected' : 'disconnected'}
        >
          <StateDot state={unavailable ? 'warning' : healthy ? 'done' : 'warning'} />
          <span>
            {unavailable
              ? t('remediationCapabilityUnavailable')
              : healthy
                ? t('remediationHealthy')
                : t('remediationIssuesFound', { count: issues.length })}
          </span>
        </div>
      )}

      {report?.capability === 'available' ? (
        <p className={css.statusDetail}>
          {t('remediationScannedSummary', { sessions: report.scannedSessions })}
        </p>
      ) : null}

      {report === undefined && !scanning && error === undefined ? (
        <p className={css.remediationIdle}>{t('remediationIdle')}</p>
      ) : null}

      <p className={css.statusDetail}>{t('remediationDescription')}</p>

      {confirming ? (
        <div className={css.remediationConfirm} role="group">
          <p className={css.remediationConfirmTitle}>{t('remediationConfirmTitle')}</p>
          <p className={css.remediationConfirmText}>
            {t('remediationConfirmBody', { count: issues.length })}
          </p>
          <p className={css.remediationConfirmText}>{t('remediationConfirmBackup')}</p>
          <p className={css.remediationConfirmWarning}>{t('remediationConfirmIrreversible')}</p>
          <div className={css.remediationActions}>
            <Button
              variant="ghost"
              size="sm"
              disabled={repairing}
              onClick={() => {
                setConfirming(false)
              }}
            >
              {t('remediationCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={repairing}
              onClick={() => {
                void repair(issues.map((issue) => issue.id))
              }}
            >
              {repairing ? t('remediationRepairing') : t('remediationConfirmAction')}
            </Button>
          </div>
        </div>
      ) : null}

      {error === undefined ? null : (
        <p className={css.diagFetchError} data-remediation-error>
          {t('remediationScanFailed')}: {error}
        </p>
      )}

      {result === undefined ? null : (
        <div className={css.remediationResultBanner}>
          {result.items.map((item) => (
            <ResultRow key={item.issueId} t={t} item={item} />
          ))}
        </div>
      )}

      {issues.length === 0 ? null : (
        <div className={css.remediationIssueList}>
          {issues.map((issue) => (
            <IssueRow key={issue.id} t={t} issue={issue} />
          ))}
        </div>
      )}
    </div>
  )
}
