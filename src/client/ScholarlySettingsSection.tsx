/**
 * Dedicated settings page for the `dsh-zotero#scholarly` row in the Plugins
 * manager, rendered in the plugins.row.config slot.
 *
 * `view === 'summary'` returns the row's one-line description. `view === 'page'`
 * renders the full Scholarly configuration form inside the SettingsForm chrome.
 * @module dsh-zotero/client/ScholarlySettingsSection
 */

import { useMemo, type ReactNode } from 'react'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ScholarlySettingsForm } from './ScholarlySettingsForm.tsx'
import type { ScholarlyCardFace } from './scholarly-form-controller.ts'
import { formLabels } from './ZoteroSettingsSection.tsx'
import css from './ZoteroSettingsSection.module.css'

export type ScholarlySettingsSectionProps = PropsRuntime<'plugins.row.config'> &
  PropsLocale<'zotero'> &
  InjectFace<ScholarlyCardFace>

export function ScholarlySettingsSection(props: ScholarlySettingsSectionProps): ReactNode {
  const { t, view } = props
  const state = props.useScholarlyCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])

  if (view === 'summary') {
    return t('tabScholarlyDesc')
  }

  return (
    <div className={css.page} data-scholarly-config-page>
      <div className={css.head}>
        <h2 className={css.title}>{t('tabScholarly')}</h2>
      </div>
      <p className={css.description}>{t('tabScholarlyDesc')}</p>
      <SettingsForm labels={labels} state={state} onSave={props.save} onDiscard={props.discard}>
        <ScholarlySettingsForm t={t} state={state} actions={props} />
      </SettingsForm>
    </div>
  )
}
