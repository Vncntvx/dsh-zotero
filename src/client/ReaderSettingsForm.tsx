/** Visible settings for Reader history and attachment-scoped reading state. */
import type { ReactNode } from 'react'
import { SettingsValueField, type SettingsFormActions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroLocaleKey } from './locales.ts'
import { BooleanField } from './fields.tsx'
import type { ReaderCardState } from './reader-settings-controller.ts'
import { ZOTERO_READER_TRANSLATION_LANGUAGES } from '../constants.ts'
import { ChoiceField } from './fields.tsx'
import css from './ZoteroSettingsForm.module.css'

interface ReaderSettingsFormProps {
  readonly t: (key: ZoteroLocaleKey) => string
  readonly state: ReaderCardState
  readonly actions: Pick<SettingsFormActions, 'edit' | 'resetField'>
}

export function ReaderSettingsForm({ t, state, actions }: ReaderSettingsFormProps): ReactNode {
  const disabled = !state.writable || state.saving
  const languages = new Intl.DisplayNames([navigator.language], { type: 'language' })
  const translationOptions = [
    { value: 'auto', label: t('readerTranslationTargetAuto') },
    ...ZOTERO_READER_TRANSLATION_LANGUAGES.map((value) => ({
      value,
      label: languages.of(value) ?? value,
    })),
  ]
  return (
    <section className={css.group} aria-label={t('groupReaderPreferences')}>
      <div className={css.groupHeader}>
        <h3 className={css.groupHeading}>{t('groupReaderPreferences')}</h3>
        <p className={css.groupNote}>{t('groupReaderPreferencesDesc')}</p>
      </div>
      <div className={css.fields}>
        <SettingsValueField
          id="reader-settings-history-limit"
          label={t('readerHistoryLimit')}
          hint={t('readerHistoryLimitHint')}
          text={state.historyLimit.text}
          overridden={state.historyLimit.overridden}
          invalid={state.historyLimit.invalid}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric
          disabled={disabled}
          onEdit={(text) => actions.edit('historyLimit', text)}
          onReset={() => actions.resetField('historyLimit')}
        />
        <BooleanField
          label={t('readerPersistReadingState')}
          hint={t('readerPersistReadingStateHint')}
          text={state.persistReadingState.text}
          overridden={state.persistReadingState.overridden}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          disabled={disabled}
          onEdit={(text) => actions.edit('persistReadingState', text)}
          onReset={() => actions.resetField('persistReadingState')}
        />
        <BooleanField
          label={t('readerCaptureWatermark')}
          hint={t('readerCaptureWatermarkHint')}
          text={state.captureWatermark.text}
          overridden={state.captureWatermark.overridden}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          disabled={disabled}
          onEdit={(text) => actions.edit('captureWatermark', text)}
          onReset={() => actions.resetField('captureWatermark')}
        />
        <ChoiceField
          id="reader-settings-translation-target"
          label={t('readerTranslationTarget')}
          hint={t('readerTranslationTargetHint')}
          value={state.defaultTranslationTarget.text}
          options={translationOptions}
          overridden={state.defaultTranslationTarget.overridden}
          invalid={state.defaultTranslationTarget.invalid}
          disabled={disabled}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          onSelect={(value) => actions.edit('defaultTranslationTarget', value)}
          onReset={() => actions.resetField('defaultTranslationTarget')}
        />
      </div>
    </section>
  )
}
