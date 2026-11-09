/**
 * Dedicated settings page for the `dsh-zotero#parsing` row in the Plugins
 * manager, rendered in the plugins.row.config slot.
 *
 * `view === 'summary'` returns the row's one-line description; `view === 'page'`
 * renders the full parsing form inside the SettingsForm chrome.
 * @module dsh-zotero/client/ParsingSettingsSection
 */

import { useMemo, type ReactNode } from 'react'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ParsingSettingsForm } from './ParsingSettingsForm.tsx'
import type { ParsingCardFace } from './parsing-form-controller.ts'
import { formLabels } from './ZoteroSettingsSection.tsx'
import css from './ZoteroSettingsSection.module.css'

export type ParsingSettingsSectionProps = PropsRuntime<'plugins.row.config'> &
  PropsLocale<'zotero'> &
  InjectFace<ParsingCardFace>

export function ParsingSettingsSection(props: ParsingSettingsSectionProps): ReactNode {
  const { t, view } = props
  const state = props.useParsingCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])

  if (view === 'summary') return t('tabParsingDesc')

  return (
    <div className={css.page} data-parsing-config-page>
      <SettingsForm labels={labels} state={state} onSave={props.save} onDiscard={props.discard}>
        <ParsingSettingsForm t={t} state={state} actions={props} />
      </SettingsForm>
    </div>
  )
}
