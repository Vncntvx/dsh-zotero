/**
 * Shared enable-risk acknowledgement: the confirming/acknowledged machine
 * behind `RiskConfirmation`, plus the write-access copy every surface that
 * can flip `writeEnabled` renders. One state shape, one dictionary mapping.
 * @module dsh-zotero/client/risk-gate
 */

import { useState } from 'react'
import type { RiskConfirmationProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroLocaleKey } from './locales.ts'

/** Dialog copy a gated toggle supplies; mirrors the primitive's labels. */
export type BooleanRiskCopy = Pick<
  RiskConfirmationProps,
  'title' | 'description' | 'acknowledgeLabel' | 'cancelLabel' | 'closeLabel' | 'confirmLabel'
>

/** Risk-dialog copy for enabling write access. */
export function writeRiskCopy(t: (key: ZoteroLocaleKey) => string): BooleanRiskCopy {
  return {
    title: t('writeRiskTitle'),
    description: t('writeRiskDescription'),
    acknowledgeLabel: t('writeRiskAcknowledge'),
    cancelLabel: t('writeRiskCancel'),
    closeLabel: t('writeRiskClose'),
    confirmLabel: t('writeRiskConfirm'),
  }
}

/** The confirm dialog's open/acknowledge state and its transitions. */
export interface RiskGate {
  readonly confirming: boolean
  readonly acknowledged: boolean
  readonly setAcknowledged: (acknowledged: boolean) => void
  /** Open the dialog with a clean acknowledgement. */
  readonly request: () => void
  /** Dismiss without applying. */
  readonly cancel: () => void
  /** Dismiss and apply the confirmed change. */
  readonly confirm: (apply: () => void) => void
}

/**
 * One enable-risk acknowledgement machine shared by the quick-config switch
 * and the settings boolean toggle.
 * @returns the gate's state and transitions.
 */
export function useRiskGate(): RiskGate {
  const [confirming, setConfirming] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  return {
    confirming,
    acknowledged,
    setAcknowledged,
    request: () => {
      setAcknowledged(false)
      setConfirming(true)
    },
    cancel: () => {
      setAcknowledged(false)
      setConfirming(false)
    },
    confirm: (apply: () => void) => {
      setAcknowledged(false)
      setConfirming(false)
      apply()
    },
  }
}
