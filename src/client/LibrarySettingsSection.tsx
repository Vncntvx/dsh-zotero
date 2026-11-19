/**
 * Dedicated settings page for the `dsh-zotero#library` row in the Plugins
 * manager, rendered in the plugins.row.config slot. Library preferences and the
 * shared CSL defaults compose into one harness `SettingsForm` and one save.
 * @module dsh-zotero/client/LibrarySettingsSection
 */

import { useMemo, type ReactNode } from 'react'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { LibrarySettingsForm } from './LibrarySettingsForm.tsx'
import type { LibraryCardFace } from './library-form-controller.ts'
import type { CitationCardFace, CitationCardState } from './citation-form-controller.ts'
import { CitationDefaultsForm } from './CitationDefaultsForm.tsx'
import { formLabels } from './ZoteroSettingsSection.tsx'
import { composeSettingsForm } from './composed-settings.ts'
import css from './ZoteroSettingsSection.module.css'

export type LibrarySettingsSectionProps = PropsRuntime<'plugins.row.config'> &
  PropsLocale<'zotero'> &
  InjectFace<LibraryCardFace> & {
    useCitationCard: SnapshotSelectorHook<CitationCardState>
    citation: CitationCardFace
  }

export function LibrarySettingsSection(props: LibrarySettingsSectionProps): ReactNode {
  const { t, view } = props
  const state = props.useLibraryCard((snapshot) => snapshot)
  const citationState = props.useCitationCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])

  if (view === 'summary') {
    return t('tabLibraryDesc')
  }

  const tab = composeSettingsForm([
    { state, save: props.save, discard: props.discard },
    {
      state: citationState,
      save: props.citation.save,
      discard: props.citation.discard,
    },
  ])

  return (
    <div className={css.page} data-library-config-page>
      <SettingsForm labels={labels} state={tab.state} onSave={tab.save} onDiscard={tab.discard}>
        {state.available ? (
          <div data-library-preferences>
            <LibrarySettingsForm
              t={t}
              state={{ ...state, saving: tab.state.saving }}
              actions={props}
            />
          </div>
        ) : null}
        {citationState.available ? (
          <CitationDefaultsForm
            t={t}
            state={{ ...citationState, saving: tab.state.saving }}
            actions={props.citation}
          />
        ) : null}
      </SettingsForm>
    </div>
  )
}
