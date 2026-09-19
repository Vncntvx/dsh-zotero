/**
 * Hand-written controls for the Zotero settings card. Each renders one field's
 * label, its staged text, whether saving would leave an override, and — when
 * one stands — the reset that stages a clear back to the composition layer.
 * Nothing here writes: a control reports what the user typed, and the card's
 * save is the single point where a draft becomes a document mutation.
 *
 * Structure, tokens, and geometry mirror the harness's official plugin fields
 * (`packages/client/ui-settings-plugins/src/client/fields.tsx` +
 * `fields.module.css`, re-checked at dsh 0.1.6-alpha.2): native inputs
 * (34px, radius 8, layer-3 surface), `Tag` override badges, `.field + .field`
 * separators, optional `help` disclosure, and the official
 * `aria-invalid` input face. Spelled here rather than imported because a
 * client bundle must not value-import another plugin's code. The Zotero form
 * itself does not pass `help` today — the control keeps the official shape so
 * a later re-diff stays a no-op. The boolean toggle has no official atom
 * (upstream ships `ValueField`/`SecretField` only), so it keeps a native
 * checkbox while reusing the official badge/reset/hint language.
 * @module dsh-zotero/client/fields
 */

import { useState, type ReactNode } from 'react'
import { IconInfoOutline14, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Shared override badge + reset pair used by every field control. */
function OverrideControls(props: {
  readonly overriddenLabel: string
  readonly resetLabel: string
  readonly disabled: boolean
  readonly onReset: () => void
}) {
  return (
    <span className={css.badges}>
      <Tag tone="neutral">{props.overriddenLabel}</Tag>
      <button type="button" className={css.reset} disabled={props.disabled} onClick={props.onReset}>
        {props.resetLabel}
      </button>
    </span>
  )
}

/**
 * A staged value field. `numeric` only hints the keypad: which drafts a field
 * accepts is decided by its spec, so the control never silently rewrites what
 * the user typed. `hint` and `help` follow the official control: an optional
 * one-line note under the input, and an optional rules disclosure beside the
 * label (the Zotero form passes neither `help` nor an empty hint today).
 * @param props - the field's copy, its staged text, and the edit actions.
 * @returns the labelled control.
 */
export function ValueField(
  props: Omit<FieldProps, 'hint'> & {
    /** Optional explanation shown below the input. */
    hint?: string
    /** Rules disclosed by the information button beside the label. */
    help?: { label: string; content: ReactNode }
    /** Hints a numeric keypad without narrowing what the control accepts. */
    numeric?: boolean
    /** Placeholder shown while the draft is empty. */
    placeholder?: string
  },
) {
  const [helpOpen, setHelpOpen] = useState(false)
  const helpId = `${props.id}-help`
  const messageId = `${props.id}-message`
  const hasMessage = props.invalid || Boolean(props.hint)
  const description = [hasMessage ? messageId : '', helpOpen ? helpId : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={css.field}>
      <div className={css.head}>
        <div className={css.labelGroup}>
          <label className={css.label} htmlFor={props.id}>
            {props.label}
          </label>
          {props.help !== undefined ? (
            <button
              type="button"
              className={css.helpButton}
              aria-label={props.help.label}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              onClick={() => {
                setHelpOpen(!helpOpen)
              }}
            >
              <IconInfoOutline14 size={12} />
            </button>
          ) : null}
        </div>
        {props.overridden ? (
          <OverrideControls
            overriddenLabel={props.overriddenLabel}
            resetLabel={props.resetLabel}
            disabled={props.disabled}
            onReset={props.onReset}
          />
        ) : null}
      </div>
      <input
        id={props.id}
        className={css.input}
        type="text"
        {...(props.numeric === true ? { inputMode: 'numeric' as const } : {})}
        {...(props.invalid ? { 'aria-invalid': true } : {})}
        aria-describedby={description || undefined}
        value={props.text}
        placeholder={props.placeholder ?? ''}
        disabled={props.disabled}
        onChange={(event) => {
          props.onEdit(event.target.value)
        }}
      />
      {hasMessage ? (
        <p id={messageId} className={props.invalid ? css.invalid : css.hint}>
          {props.invalid ? props.invalidLabel : props.hint}
        </p>
      ) : null}
      {props.help !== undefined && helpOpen ? (
        <div id={helpId} className={css.help} role="region" aria-label={props.help.label}>
          {props.help.content}
        </div>
      ) : null}
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
export function BooleanField(props: Omit<FieldProps, 'invalid' | 'invalidLabel'>) {
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
          <OverrideControls
            overriddenLabel={props.overriddenLabel}
            resetLabel={props.resetLabel}
            disabled={props.disabled}
            onReset={props.onReset}
          />
        ) : null}
      </div>
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}
