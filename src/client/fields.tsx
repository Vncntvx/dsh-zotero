/**
 * Hand-written control for the Zotero settings card. Each renders one field's
 * label, its staged text, whether saving would leave an override, and — when
 * one stands — the reset that stages a clear back to the composition layer.
 * Nothing here writes: a control reports what the user typed, and the card's
 * save is the single point where a draft becomes a document mutation.
 *
 * The control reuses the harness's official `Input` primitive (32px, radius
 * 8, brand focus ring) and the shared `--dsw-alias-*` tokens, so it matches
 * the settings surface without shipping a CSS pipeline in the client bundle.
 * @module dsh-zotero/client/fields
 */

import type { CSSProperties } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'

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

const row: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '5px 0',
}

const head: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

const labelStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  lineHeight: 1.4,
}

const badge: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
}

const resetButton: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  color: 'var(--dsw-alias-brand-primary)',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
}

const hint: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  lineHeight: 1.4,
}

const invalid: CSSProperties = {
  ...hint,
  color: 'var(--dsw-alias-state-error-primary)',
}

// The primitives Input owns its wrapper's border, so an invalid draft needs a
// style sheet entry rather than a style prop; inject it once, in the same
// data-plugin-css pattern the harness's own client bundles use.
if (
  typeof document !== 'undefined' &&
  document.querySelector('style[data-plugin-css="dsh-zotero/fields"]') === null
) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-zotero'
  tag.dataset.pluginCss = 'dsh-zotero/fields'
  tag.textContent = '.dsh-zotero-input-invalid{border-color:var(--dsw-alias-state-error-primary)}'
  document.head.appendChild(tag)
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
    <div style={row}>
      <div style={head}>
        <label style={labelStyle} htmlFor={props.id}>
          {props.label}
        </label>
        {props.overridden ? (
          <span style={badge}>
            {props.overriddenLabel}{' '}
            <button
              type="button"
              style={resetButton}
              disabled={props.disabled}
              onClick={props.onReset}
            >
              {props.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      <Input
        id={props.id}
        className={props.invalid ? 'dsh-zotero-input-invalid' : undefined}
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
      <p style={props.invalid ? invalid : hint}>
        {props.invalid ? props.invalidLabel : props.hint}
      </p>
    </div>
  )
}

const toggleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const toggleLabel: CSSProperties = {
  ...labelStyle,
  cursor: 'pointer',
}

const toggle: CSSProperties = {
  width: 16,
  height: 16,
  margin: 0,
  accentColor: 'var(--dsw-alias-state-business-primary)',
  cursor: 'pointer',
}

const toggleHint: CSSProperties = {
  ...hint,
  margin: '2px 0 0 24px',
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
    <div style={row}>
      <div style={toggleRow}>
        <input
          id={props.id}
          type="checkbox"
          style={toggle}
          checked={props.text === 'true'}
          disabled={props.disabled}
          onChange={(event) => {
            props.onEdit(event.target.checked ? 'true' : 'false')
          }}
        />
        <label style={toggleLabel} htmlFor={props.id}>
          {props.label}
        </label>
        {props.overridden ? (
          <span style={badge}>
            {props.overriddenLabel}{' '}
            <button
              type="button"
              style={resetButton}
              disabled={props.disabled}
              onClick={props.onReset}
            >
              {props.resetLabel}
            </button>
          </span>
        ) : null}
      </div>
      <p style={toggleHint}>{props.hintLabel}</p>
    </div>
  )
}
