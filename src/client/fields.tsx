/**
 * The staged boolean control for the Zotero settings card: a checkbox toggle.
 * Value inputs ride the harness's own `SettingsValueField` (imported from
 * `dsh-client-ui-primitives` at the call site); only the toggle lives here
 * because upstream ships no boolean atom — value/secret fields only. The
 * draft text is the literal 'true'/'false' the boolean spec round-trips;
 * checking the box stages the opposite value, and reset restages the
 * composition layer. Shared badge/reset/hint language matches the official
 * control.
 * @module dsh-zotero/client/fields
 */

import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './fields.module.css'

/** What the toggle needs: label, staged text, override state, and actions. */
export interface BooleanFieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
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
}

/**
 * A staged boolean field rendered as a checkbox toggle.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled toggle control.
 */
export function BooleanField(props: BooleanFieldProps) {
  return (
    <div className={css.field}>
      <div className={css.toggleRow}>
        <input
          id={props.id}
          type="checkbox"
          className={css.toggle}
          checked={props.text === 'true'}
          disabled={props.disabled}
          onChange={(event) => {
            props.onEdit(event.target.checked ? 'true' : 'false')
          }}
        />
        <label className={css.toggleLabel} htmlFor={props.id}>
          {props.label}
        </label>
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
    </div>
  )
}
