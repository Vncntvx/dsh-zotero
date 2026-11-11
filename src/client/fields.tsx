/**
 * The staged boolean row for the Zotero settings card. The control itself is
 * the harness's own `Checkbox` (visible and accessible label in one); value
 * inputs ride the harness's `SettingsValueField` at the call site, and only
 * the composite row stays local: override badge, reset, hint, and the risk
 * gate that intercepts enabling so sensitive flags (write access) cannot flip
 * on without explicit acknowledgement. The draft text is the literal
 * 'true'/'false' the boolean spec round-trips: checking the box stages the
 * opposite value, and reset restages the composition layer.
 * @module dsh-zotero/client/fields
 */

import { useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  IconChevronDownOutlineRegular,
  Menu,
  MenuItemButton,
  RiskConfirmation,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useRiskGate, type BooleanRiskCopy } from './risk-gate.ts'
import css from './fields.module.css'

/** What the toggle needs: label, staged text, override state, and actions. */
interface BooleanFieldProps {
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
            <Button variant="ghost" size="sm" disabled={props.disabled} onClick={props.onReset}>
              {props.resetLabel}
            </Button>
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

/** One selectable option of a choice field: the value plus its label. */
export interface ChoiceOption {
  readonly value: string
  readonly label: string
}

/** Props of the shared choice row; the label doubles as the accessible name. */
export interface ChoiceFieldProps {
  /** Stable DOM id for the trigger button. */
  id: string
  /** Visible label above the control. */
  label: string
  /** One-line explanation rendered under the control. */
  hint?: string
  /** The staged value; rendered as its option's label when known. */
  value: string
  /** The closed option set, in display order. */
  options: readonly ChoiceOption[]
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the staged value is outside the option set. */
  invalid?: boolean
  /** Disables the control. */
  disabled: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Stage the chosen value. */
  onSelect: (value: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/**
 * A staged closed-choice row: label head with the override/reset badges, and
 * the official `Menu` over an outline button. Both settings forms render their
 * choice fields through this one component, so an accessibility or styling fix
 * cannot land in one form and miss the other.
 * @param props - the field's copy, its options, and the edit actions.
 * @returns the choice row.
 */
export function ChoiceField(props: ChoiceFieldProps): ReactNode {
  const [open, setOpen] = useState(false)
  const currentOption = props.options.find((option) => option.value === props.value)
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <span className={css.fieldLabel}>{props.label}</span>
        {props.overridden && (
          <span className={css.badges}>
            <Tag tone="neutral">{props.overriddenLabel}</Tag>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled}
              aria-label={`${props.resetLabel}: ${props.label}`}
              onClick={props.onReset}
            >
              {props.resetLabel}
            </Button>
          </span>
        )}
      </div>
      <Menu
        open={open && !props.disabled}
        onClose={() => setOpen(false)}
        className={css.choiceMenu}
        portal
        autoFocus
        minWidthFromAnchor
        anchor={
          <Button
            id={props.id}
            variant="outline"
            size="md"
            className={css.choiceControl}
            disabled={props.disabled}
            onClick={() => setOpen((v) => !v)}
            aria-label={props.label}
            aria-haspopup="menu"
            aria-expanded={open && !props.disabled}
            aria-invalid={props.invalid}
          >
            <span>{currentOption?.label ?? props.value}</span>
            <IconChevronDownOutlineRegular />
          </Button>
        }
      >
        {props.options.map((option) => (
          <MenuItemButton
            key={option.value}
            current={option.value === props.value}
            onSelect={() => {
              props.onSelect(option.value)
              setOpen(false)
            }}
          >
            {option.label}
          </MenuItemButton>
        ))}
      </Menu>
      {props.hint !== undefined && <p className={css.hint}>{props.hint}</p>}
    </div>
  )
}
