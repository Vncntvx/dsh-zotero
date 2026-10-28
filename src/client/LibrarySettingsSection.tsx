/**
 * Dedicated settings page for the `dsh-zotero#library` row in the Plugins
 * manager, rendered in the plugins.row.config slot.
 * @module dsh-zotero/client/LibrarySettingsSection
 */

import { useMemo, type ReactNode } from 'react'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LibrarySettingsForm } from './LibrarySettingsForm.tsx'
import type { LibraryCardFace } from './library-form-controller.ts'
import { formLabels } from './ZoteroSettingsSection.tsx'
import css from './ZoteroSettingsSection.module.css'

export type LibrarySettingsSectionProps = PropsRuntime<'plugins.row.config'> &
  PropsLocale<'zotero'> &
  InjectFace<LibraryCardFace>

export function LibrarySettingsSection(props: LibrarySettingsSectionProps): ReactNode {
  const { t, view } = props
  const state = props.useLibraryCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])

  if (view === 'summary') {
    return t('tabLibraryDesc')
  }

  return (
    <div className={css.page} data-library-config-page>
      <SettingsForm labels={labels} state={state} onSave={props.save} onDiscard={props.discard}>
        <LibrarySettingsForm t={t} state={state} actions={props} />
      </SettingsForm>
    </div>
  )
}
