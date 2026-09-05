/**
 * Hand-written controls for the Zotero settings card. Each renders one field's
 * label, its staged text, whether saving would leave an override, and — when
 * one stands — the reset that stages a clear back to the composition layer.
 * Nothing here writes: a control reports what the user typed, and the card's
 * save is the single point where a draft becomes a document mutation.
 *
 * Structure, tokens, and geometry mirror the harness's official plugin fields
 * (`packages/client/ui-settings-plugins/src/client/fields.tsx` +
 * `fields.module.css`): native inputs (34px, radius 8, layer-3 surface),
 * pill override badges, and `.field + .field` separators. Spelled here rather
 * than imported because a client bundle must not value-import another
 * plugin's code. The boolean toggle has no official atom (the official module
 * ships only `ValueField`/`SecretField`), so it keeps a native checkbox while
 * reusing the official badge/reset/hint language.
 * @module dsh-zotero/client/fields
 */

import css from './fields.module.css'

/** What every field control needs regardless of its value type. */
export interface FieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders. */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the draft is not a value this field accepts. */
  invalid: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string
  /** Disables the control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(
  props: FieldProps & {
    /** Hints a numeric keypad without narrowing what the control accepts. */
    numeric?: boolean
    /** Placeholder shown while the draft is empty. */
    placeholder?: string
  },
) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>
          {props.label}
        </label>
        {props.overridden ? (
          <span className={css.badges}>
            <span className={css.badge}>{props.overriddenLabel}</span>
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
      <input
        id={props.id}
        className={props.invalid ? css.inputInvalid : css.input}
        type="text"
        {...(props.numeric === true ? { inputMode: 'numeric' as const } : {})}
        {...(props.invalid ? { 'aria-invalid': true } : {})}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => {
          props.onEdit(event.target.value)
        }}
      />
      <p className={props.invalid ? css.invalid : css.hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

/**
 * A staged boolean field rendered as a checkbox toggle. The draft text is
 * the literal 'true'/'false' the boolean spec round-trips; checking the box
 * stages the opposite value, and reset restages the composition layer.
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled toggle control.
 */
export function BooleanField(
  props: Omit<FieldProps, 'hint' | 'invalidLabel'> & {
    /** Placeholder hint shown under the control. */
    hintLabel: string
  },
) {
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
            <span className={css.badge}>{props.overriddenLabel}</span>
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
      <p className={css.hint}>{props.hintLabel}</p>
    </div>
  )
}
