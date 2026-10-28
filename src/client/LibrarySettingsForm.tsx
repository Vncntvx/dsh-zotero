/**
 * The library subsystem's settings form body: right sidebar enablement (the
 * sidebar tab). Shared by the unified settings view and the
 * `dsh-zotero#library` row configuration page.
 * @module dsh-zotero/client/LibrarySettingsForm
 */

import type { ReactNode } from 'react'
import type { SettingsFormActions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ZoteroLocaleKey } from './locales.ts'
import { BooleanField } from './fields.tsx'
import type { LibraryCardState } from './library-form-controller.ts'
import css from './ZoteroSettingsForm.module.css'

type LibraryFormActions = Pick<SettingsFormActions, 'edit' | 'resetField'>

interface LibrarySettingsFormProps {
  t: (key: ZoteroLocaleKey) => string
  state: LibraryCardState
  actions: LibraryFormActions
}

export function LibrarySettingsForm(props: LibrarySettingsFormProps): ReactNode {
  const { t, state, actions } = props
  const disabled = !state.writable || state.saving

  return (
    <section className={css.group} aria-label={t('groupLibrarySidebar')}>
      <div className={css.groupHeader}>
        <h3 className={css.groupHeading}>{t('groupLibrarySidebar')}</h3>
        <p className={css.groupNote}>{t('groupLibrarySidebarDesc')}</p>
      </div>
      <div className={css.fields}>
        <BooleanField
          label={t('rightSidebarEnabled')}
          hint={t('rightSidebarHint')}
          text={state.rightSidebarEnabled.text}
          overridden={state.rightSidebarEnabled.overridden}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          disabled={disabled}
          onEdit={(text) => actions.edit('rightSidebarEnabled', text)}
          onReset={() => actions.resetField('rightSidebarEnabled')}
        />
      </div>
    </section>
  )
}
