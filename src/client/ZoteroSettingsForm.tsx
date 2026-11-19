/**
 * The general settings form body: the 13 visible connection, capability and
 * runtime configuration fields, grouped as elevated cards. The other 24
 * namespace fields stay in the schema and the profile config file; they are
 * not rendered here.
 *
 * Groups: conversation tab and personal library write gate, Local API
 * connection, search and browsing limits, passage and full-text budgets,
 * background job policy, and diagnostics.
 *
 * The form renders inside the `plugins.bundle.config` slot on the Zotero
 * plugin details page. The official `<SettingsForm>` supplies the chrome
 * (status lines, failed notice, save button); this module owns the group cards
 * and per-field controls.
 * @module dsh-zotero/client/ZoteroSettingsForm
 */

import type { ReactNode } from 'react'
import { SettingsValueField, type SettingsFormActions } from '@deepseek-ai/dsh-client-ui-primitives'
import { BooleanField } from './fields.tsx'
import { writeRiskCopy } from './risk-gate.ts'
import {
  BOOLEAN_FIELD_KEYS,
  FIELD_GROUPS,
  NUMERIC_FIELD_KEYS,
  type GroupKey,
  type VisibleFieldKey,
  type ZoteroCardState,
} from './zotero-card-controller.ts'
import type { ZoteroLocaleKey } from './locales.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView, ZoteroWriteGrantRevokeView } from '../contract.ts'
import { WriteGrantAction } from './components/WriteGrantAction.tsx'
import css from './ZoteroSettingsForm.module.css'

/** Field-editing actions, wired from the surface's card face. */
type ZoteroFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>

/** What the form body needs from its surface: copy, snapshot, and actions. */
interface ZoteroSettingsFormProps {
  /** Locale reader bound to the plugin dictionary. */
  t: (key: ZoteroLocaleKey) => string
  /** The card snapshot, from the surface's bound selector. */
  state: ZoteroCardState
  /** The form's staged-edit actions. */
  actions: ZoteroFormActions
  /** Live connectivity probe, for the write-grant row. */
  probe?: () => Promise<RemoteResult<ZoteroStatusView>>
  /** Revoke the persisted write grant, for the write-grant row. */
  revokeWriteGrant?: () => Promise<RemoteResult<ZoteroWriteGrantRevokeView>>
}

/**
 * Render the grouped general settings view.
 * @param props - copy, snapshot, and staged-edit actions.
 * @returns the grouped form view.
 */
export function ZoteroSettingsForm(props: ZoteroSettingsFormProps) {
  const { t, state, actions } = props
  const grant =
    props.probe !== undefined && props.revokeWriteGrant !== undefined
      ? { probe: props.probe, revoke: props.revokeWriteGrant }
      : undefined

  return (
    <>
      {FIELD_GROUPS.map(({ key, fields }) =>
        renderGroupSection(t, state, actions, key, fields, grant),
      )}
    </>
  )
}

function renderGroupSection(
  t: (key: ZoteroLocaleKey) => string,
  state: ZoteroCardState,
  actions: ZoteroFormActions,
  groupKey: GroupKey,
  fields: readonly VisibleFieldKey[],
  grant?: {
    readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
    readonly revoke: () => Promise<RemoteResult<ZoteroWriteGrantRevokeView>>
  },
): ReactNode {
  return (
    <section key={groupKey} className={css.group} aria-label={t(groupKey)}>
      <div className={css.groupHeader}>
        <h3 className={css.groupHeading}>{t(groupKey)}</h3>
        <p className={css.groupNote}>{t(`${groupKey}Desc`)}</p>
      </div>
      <div className={css.fields}>
        {fields.map((key) => field(t, state, actions, key))}
        {groupKey === 'groupWrite' && grant !== undefined && (
          <WriteGrantAction t={t} probe={grant.probe} revoke={grant.revoke} />
        )}
      </div>
    </section>
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
  key: VisibleFieldKey,
): ReactNode {
  const shared = {
    overriddenLabel: t('overridden'),
    resetLabel: t('reset'),
    // Disabled while the Host is read-only **or** a save is crossing the wire:
    // SettingsFormModel.save() clears every staged draft on success, so an edit
    // typed during the round-trip would be dropped with them.
    disabled: !state.writable || state.saving,
    ...state[key],
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
        label={t(key)}
        hint={t(`${key}Hint`)}
        risk={key === 'writeEnabled' ? writeRiskCopy(t) : undefined}
        {...shared}
      />
    )
  }
  return (
    <SettingsValueField
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
