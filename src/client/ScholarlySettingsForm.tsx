/**
 * The Scholarly literature subsystem settings form body.
 *
 * Two card containers: API credentials and identification (the polite pool
 * contact email and the external scholarly API keys), and search and
 * full-text quotas (search limit, content character ceiling, cache folder).
 *
 * Shared by the unified 5-tab settings view (Tab 4) and the dedicated
 * `dsh-zotero#scholarly` row configuration page.
 * @module dsh-zotero/client/ScholarlySettingsForm
 */

import type { ReactNode } from 'react'
import {
  SettingsSecretField,
  SettingsValueField,
  type SettingsFormActions,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroLocaleKey } from './locales.ts'
import type {
  ScholarlyCardState,
  ScholarlyNumericKey,
  ScholarlySecretKey,
  ScholarlyTextKey,
} from './scholarly-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'

/** Field-editing actions, wired from the surface's card face. */
type ScholarlyFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>

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
          {renderValueField(t, state, actions, 'enabled', false)}
          {renderValueField(t, state, actions, 'email', false)}
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
          {renderValueField(t, state, actions, 'maxResults', true)}
          {renderValueField(t, state, actions, 'maxContentChars', true)}
        </div>
      </section>
    </>
  )
}

function renderValueField(
  t: (key: ZoteroLocaleKey) => string,
  state: ScholarlyCardState,
  actions: ScholarlyFormActions,
  key: ScholarlyTextKey | ScholarlyNumericKey | 'enabled',
  numeric: boolean,
): ReactNode {
  const field = state[key]
  const labelKey = `scholarly${key.charAt(0).toUpperCase()}${key.slice(1)}` as ZoteroLocaleKey
  const hintKey = `${labelKey}Hint` as ZoteroLocaleKey
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
      invalidLabel={t('invalidNumber')}
      disabled={!state.writable || state.saving}
      numeric={numeric}
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
  const hintKey = `${labelKey}Hint` as ZoteroLocaleKey
  return (
    <SettingsSecretField
      key={key}
      id={`scholarly-settings-${key}`}
      label={t(labelKey)}
      hint={t(hintKey)}
      text={secret.text}
      configured={secret.configured}
      stateLabel={secret.configured ? t('secretConfigured') : t('secretNotConfigured')}
      disabled={!state.writable || state.saving}
      onEdit={(text) => actions.edit(key, text)}
    />
  )
}
