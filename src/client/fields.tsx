/**
 * The staged boolean row for the Zotero settings card. The control itself is
 * the harness's own `Checkbox` (visible and accessible label in one); value
 * inputs ride the harness's `SettingsValueField` at the call site, and only
 * the composite row stays local — override badge, reset, hint, and the risk
 * gate that intercepts enabling so sensitive flags (write access) cannot flip
 * on without explicit acknowledgement. The draft text is the literal
 * 'true'/'false' the boolean spec round-trips: checking the box stages the
 * opposite value, and reset restages the composition layer.
 * @module dsh-zotero/client/fields
 */

import { type ReactNode } from 'react'
import { Checkbox, RiskConfirmation, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRiskGate, type BooleanRiskCopy } from './risk-gate.ts'
import css from './fields.module.css'

export type { BooleanRiskCopy } from './risk-gate.ts'

/** What the toggle needs: label, staged text, override state, and actions. */
export interface BooleanFieldProps {
  /** Visible label; the official checkbox renders it as the accessible name. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders ('true'/'false'). */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Disables the control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
  /** When set, enabling requires acknowledging this risk dialog first. */
  risk?: BooleanRiskCopy
}

/**
 * A staged boolean field rendered around the official checkbox.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled toggle row.
 */
export function BooleanField(props: BooleanFieldProps): ReactNode {
  const gate = useRiskGate()
  const enabled = props.text === 'true'
  const risk = props.risk

  const stage = (next: boolean): void => {
    props.onEdit(next ? 'true' : 'false')
  }

  return (
    <div className={css.field}>
      <div className={css.toggleRow}>
        <Checkbox
          checked={enabled}
          disabled={props.disabled}
          label={props.label}
          onChange={(next) => {
            if (next && risk !== undefined && !enabled) {
              gate.request()
              return
            }
            stage(next)
          }}
        />
        {props.overridden ? (
          <span className={css.badges}>
            <Tag tone="neutral">{props.overriddenLabel}</Tag>
            <button
              type="button"
              className={css.reset}
              disabled={props.disabled}
              onClick={props.onReset}
            >
              {props.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      <p className={css.hint}>{props.hint}</p>
      {risk !== undefined ? (
        <RiskConfirmation
          open={gate.confirming}
          title={risk.title}
          description={risk.description}
          acknowledgeLabel={risk.acknowledgeLabel}
          cancelLabel={risk.cancelLabel}
          closeLabel={risk.closeLabel}
          confirmLabel={risk.confirmLabel}
          acknowledged={gate.acknowledged}
          disabled={props.disabled}
          onAcknowledgedChange={gate.setAcknowledged}
          onCancel={gate.cancel}
          onConfirm={() => {
            gate.confirm(() => {
              stage(true)
            })
          }}
        />
      ) : null}
    </div>
  )
}
