/**
 * The Zotero settings form body: every field of the `zotero` namespace,
 * grouped into the families the host schema declares.
 *
 * The Plugins-tab card renders this body inside its disclosure, so the fields
 * behave and look like the harness's own plugin cards. The chrome around it
 * (card header, save footer) belongs to the card; this module owns only the
 * groups and the per-field controls.
 * @module dsh-zotero/client/ZoteroSettingsForm
 */

import type { ReactNode } from 'react'
import type { CSSProperties } from 'react'
import { BooleanField, ValueField } from './fields.tsx'
import type { CardActions } from './card-form.ts'
import {
  BOOLEAN_FIELD_KEYS,
  FIELD_GROUPS,
  NUMERIC_FIELD_KEYS,
  type FieldKey,
  type ZoteroCardState,
} from './zotero-card-controller.ts'
import type { ZoteroLocaleKey } from './locales.ts'

/** Field-editing actions a surface wires from its card face. */
export type ZoteroFormActions = Pick<CardActions, 'edit' | 'resetField'>

/** Props the form body needs from its surface: copy, snapshot, and actions. */
export interface ZoteroSettingsFormProps {
  /** Locale reader bound to the plugin dictionary. */
  t: (key: ZoteroLocaleKey) => string
  /** The card snapshot the surface's bound selector produces. */
  state: ZoteroCardState
  /** The form's staged-edit actions. */
  actions: ZoteroFormActions
}

const group: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const groupTitle: CSSProperties = {
  margin: 0,
  padding: '10px 0 4px',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const fields: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

/**
 * Render every group of the namespace's fields.
 * @param props - copy, snapshot, and staged-edit actions.
 * @returns the group sections.
 */
export function ZoteroSettingsForm(props: ZoteroSettingsFormProps) {
  const { t, state, actions } = props
  return (
    <>
      {FIELD_GROUPS.map(({ key: groupKey, fields: keys }) => (
        <section key={groupKey} style={group} aria-label={t(groupKey)}>
          <h3 style={groupTitle}>{t(groupKey)}</h3>
          <div style={fields}>{keys.map((key) => field(t, state, actions, key))}</div>
        </section>
      ))}
    </>
  )
}

/**
 * One field control bound to the form's state and actions.
 * @param t - locale reader.
 * @param state - the card snapshot.
 * @param actions - staged-edit actions.
 * @param key - the field key, naming both the copy and the state member.
 * @returns the labelled control.
 */
function field(
  t: (key: ZoteroLocaleKey) => string,
  state: ZoteroCardState,
  actions: ZoteroFormActions,
  key: FieldKey,
): ReactNode {
  const shared = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    disabled: !state.writable,
    ...state[key],
    // The web tab toggle's own state is its undo, so it carries no override
    // marker (no badge, no reset); every other field keeps it.
    overridden: key === 'webEnabled' ? false : state[key].overridden,
    onEdit: (text: string) => {
      actions.edit(key, text)
    },
    onReset: () => {
      actions.resetField(key)
    },
  }
  if (BOOLEAN_FIELD_KEYS.has(key)) {
    return (
      <BooleanField
        key={key}
        id={`zotero-settings-${key}`}
        label={t(key)}
        hintLabel={t(`${key}Hint`)}
        {...shared}
      />
    )
  }
  return (
    <ValueField
      key={key}
      id={`zotero-settings-${key}`}
      label={t(key)}
      hint={t(`${key}Hint`)}
      invalidLabel={t('invalidNumber')}
      numeric={NUMERIC_FIELD_KEYS.has(key)}
      {...shared}
    />
  )
}
