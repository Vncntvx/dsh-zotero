/**
 * The Scholarly literature subsystem settings form body.
 *
 * Two card containers: API credentials and identification (the polite pool
 * contact email and the external scholarly API keys), and search and
 * full-text quotas (search limit and content character ceiling).
 *
 * Shared by the unified 7-tab settings view (Tab 5) and the dedicated
 * `dsh-zotero#scholarly` row configuration page.
 * @module dsh-zotero/client/ScholarlySettingsForm
 */

import type { ReactNode } from 'react'
import {
  SettingsSecretField,
  SettingsValueField,
  type SettingsFormActions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { BooleanField } from './fields.tsx'
import type { ZoteroLocaleKey } from './locales.ts'
import {
  SCHOLARLY_NUMERIC_KEYS,
  type ScholarlyBooleanKey,
  type ScholarlyCardState,
  type ScholarlyNumericKey,
  type ScholarlySecretKey,
  type ScholarlyTextKey,
} from './scholarly-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'

/** Field-editing actions, wired from the surface's card face. */
type ScholarlyFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>

/**
 * The fields rendered as numbers, taken from the controller's own key list.
 */
const NUMERIC_FIELDS: ReadonlySet<string> = new Set(SCHOLARLY_NUMERIC_KEYS)

/** What the form body needs: copy, snapshot, and staged-edit actions. */
interface ScholarlySettingsFormProps {
  /** Locale reader bound to the plugin dictionary. */
  t: (key: ZoteroLocaleKey) => string
  /** The card snapshot, from ScholarlyFormController. */
  state: ScholarlyCardState
  /** The form's staged-edit actions. */
  actions: ScholarlyFormActions
}

/**
 * Render the two Scholarly configuration group cards.
 */
export function ScholarlySettingsForm(props: ScholarlySettingsFormProps): ReactNode {
  const { t, state, actions } = props

  return (
    <>
      <section className={css.group} aria-label={t('groupScholarlyAuth')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupScholarlyAuth')}</h3>
          <p className={css.groupNote}>{t('groupScholarlyAuthDesc')}</p>
        </div>
        <div className={css.fields}>
          {renderValueField(t, state, actions, 'email')}
          {renderValueField(t, state, actions, 's2ApiKeyEnv')}
          {renderValueField(t, state, actions, 'ncbiApiKeyEnv')}
          {renderValueField(t, state, actions, 'openalexApiKeyEnv')}
          {renderSecretField(t, state, actions, 's2Key')}
          {renderSecretField(t, state, actions, 'ncbiKey')}
          {renderSecretField(t, state, actions, 'openalexKey')}
        </div>
      </section>

      <section className={css.group} aria-label={t('groupScholarlyLimits')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupScholarlyLimits')}</h3>
          <p className={css.groupNote}>{t('groupScholarlyLimitsDesc')}</p>
        </div>
        <div className={css.fields}>
          {renderValueField(t, state, actions, 'maxResults')}
          {renderValueField(t, state, actions, 'maxContentChars')}
        </div>
      </section>

      <section className={css.group} aria-label={t('groupJobs')}>
        <div className={css.groupHeader}>
          <h3 className={css.groupHeading}>{t('groupJobs')}</h3>
          <p className={css.groupNote}>{t('groupJobsDesc')}</p>
        </div>
        <div className={css.fields}>
          {renderBooleanField(t, state, actions, 'enableRunInBackground')}
          {renderBooleanField(t, state, actions, 'promoteOnTimeout')}
          {renderJobWaitField(t, state, actions)}
        </div>
      </section>
    </>
  )
}

function renderValueField(
  t: (key: ZoteroLocaleKey) => string,
  state: ScholarlyCardState,
  actions: ScholarlyFormActions,
  key: ScholarlyTextKey | ScholarlyNumericKey,
): ReactNode {
  const field = state[key]
  const labelKey = `scholarly${key.charAt(0).toUpperCase()}${key.slice(1)}` as ZoteroLocaleKey
  const hintKey = `${labelKey}Hint` as ZoteroLocaleKey
  const credentialRef = key.endsWith('ApiKeyEnv')
  return (
    <SettingsValueField
      key={key}
      id={`scholarly-settings-${key}`}
      label={t(labelKey)}
      hint={t(hintKey)}
      text={field.text}
      overridden={field.overridden}
      invalid={field.invalid}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={t(credentialRef ? 'invalidCredentialRef' : 'invalidNumber')}
      disabled={!state.writable || state.saving}
      numeric={NUMERIC_FIELDS.has(key)}
      onEdit={(text) => actions.edit(key, text)}
      onReset={() => actions.resetField(key)}
    />
  )
}

function renderJobWaitField(
  t: (key: ZoteroLocaleKey) => string,
  state: ScholarlyCardState,
  actions: ScholarlyFormActions,
): ReactNode {
  const field = state.foregroundWaitMs
  return (
    <SettingsValueField
      key="foregroundWaitMs"
      id="scholarly-settings-foregroundWaitMs"
      label={t('foregroundWaitMs')}
      hint={t('foregroundWaitMsHint')}
      text={field.text}
      overridden={field.overridden}
      invalid={field.invalid}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={t('invalidNumber')}
      disabled={!state.writable || state.saving}
      numeric
      onEdit={(text) => actions.edit('foregroundWaitMs', text)}
      onReset={() => actions.resetField('foregroundWaitMs')}
    />
  )
}

function renderBooleanField(
  t: (key: ZoteroLocaleKey) => string,
  state: ScholarlyCardState,
  actions: ScholarlyFormActions,
  key: ScholarlyBooleanKey,
): ReactNode {
  const field = state[key]
  return (
    <BooleanField
      key={key}
      label={t(key)}
      hint={t(`${key}Hint` as ZoteroLocaleKey)}
      text={field.text}
      overridden={field.overridden}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      disabled={!state.writable || state.saving}
      onEdit={(text) => actions.edit(key, text)}
      onReset={() => actions.resetField(key)}
    />
  )
}

function renderSecretField(
  t: (key: ZoteroLocaleKey) => string,
  state: ScholarlyCardState,
  actions: ScholarlyFormActions,
  key: ScholarlySecretKey,
): ReactNode {
  const secret = state[key]
  const labelKey = `scholarly${key.charAt(0).toUpperCase()}${key.slice(1)}` as ZoteroLocaleKey
  const hintKey =
    secret.referenceState === 'missing'
      ? 'scholarlyKeyNeedsReference'
      : secret.referenceState === 'invalid'
        ? 'invalidCredentialRef'
        : (`${labelKey}Hint` as ZoteroLocaleKey)
  return (
    <SettingsSecretField
      key={key}
      id={`scholarly-settings-${key}`}
      label={t(labelKey)}
      hint={t(hintKey)}
      text={secret.text}
      configured={secret.configured}
      stateLabel={secret.configured ? t('secretConfigured') : t('secretNotConfigured')}
      disabled={secret.disabled}
      onEdit={(text) => actions.edit(key, text)}
    />
  )
}
