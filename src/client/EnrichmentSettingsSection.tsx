/**
 * Dedicated settings page for the `dsh-zotero#enrichment` row in the Plugins
 * manager, rendered in the plugins.row.config slot.
 *
 * `view === 'summary'` returns the row's one-line description; `view === 'page'`
 * renders the full enrichment form inside the SettingsForm chrome.
 * @module dsh-zotero/client/EnrichmentSettingsSection
 */

import { useMemo, type ReactNode } from 'react'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EnrichmentSettingsForm } from './EnrichmentSettingsForm.tsx'
import type { EnrichmentCardFace } from './enrichment-form-controller.ts'
import { formLabels } from './ZoteroSettingsSection.tsx'
import css from './ZoteroSettingsSection.module.css'

export type EnrichmentSettingsSectionProps = PropsRuntime<'plugins.row.config'> &
  PropsLocale<'zotero'> &
  InjectFace<EnrichmentCardFace>

export function EnrichmentSettingsSection(props: EnrichmentSettingsSectionProps): ReactNode {
  const { t, view } = props
  const state = props.useEnrichmentCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])

  if (view === 'summary') return t('tabEnrichmentDesc')

  return (
    <div className={css.page} data-enrichment-config-page>
      <SettingsForm labels={labels} state={state} onSave={props.save} onDiscard={props.discard}>
        <EnrichmentSettingsForm t={t} state={state} actions={props} />
      </SettingsForm>
    </div>
  )
}
