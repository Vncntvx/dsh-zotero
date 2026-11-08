/** Direct CSL editing in both Literature panel settings entrances. */
import {
  SettingsForm,
  SettingsValueField,
  type SettingsFormLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CITATION_FIELD_KEYS,
  type CitationCardState,
  type CitationCardFace,
} from './citation-form-controller.ts'
import type { ZoteroLocaleKey } from './locales.ts'
import css from './ZoteroSettingsForm.module.css'

export function CitationDefaultsForm(props: {
  t(key: ZoteroLocaleKey): string
  state: CitationCardState
  actions: CitationCardFace
  labels: SettingsFormLabels
}) {
  const { t, state, actions, labels } = props
  return (
    <section className={css.group} aria-label={t('groupDefaults')}>
      <div className={css.groupHeader}>
        <h3 className={css.groupHeading}>{t('groupDefaults')}</h3>
        <p className={css.groupNote}>{t('groupDefaultsDesc')}</p>
      </div>
      <SettingsForm labels={labels} state={state} onSave={actions.save} onDiscard={actions.discard}>
        <div className={css.fields}>
          {CITATION_FIELD_KEYS.map((key) => (
            <SettingsValueField
              key={key}
              id={`zotero-settings-${key}`}
              label={t(key)}
              hint={t(`${key}Hint`)}
              invalidLabel={t('invalidCitationDefault')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              disabled={!state.writable || state.saving}
              {...state[key]}
              onEdit={(text) => actions.edit(key, text)}
              onReset={() => actions.resetField(key)}
            />
          ))}
        </div>
      </SettingsForm>
    </section>
  )
}
