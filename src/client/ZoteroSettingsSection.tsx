/**
 * The Zotero settings page: one entry in the Settings panel's left navigation,
 * a sibling of General, Models, and Plugins, editing every field of the
 * `zotero` namespace the host half registers. The whole configuration lives
 * here — the page owns the header, the grouped form body, and the save footer,
 * so a namespace with this many fields never has to be read through a
 * collapsed card.
 *
 * The page reads and writes through the shared configuration form
 * (`ctx.configForms.get`), staged through the harness's own
 * `SettingsFormModel`; nothing writes until Save, and the footer's Discard
 * drops the staged edits. While the namespace is not served to this client
 * the page still renders — the left-nav entry exists either way — with its
 * title and an explanation instead of vanishing.
 *
 * The chrome is spelled here rather than imported because a client bundle must
 * not value-import another plugin's code (the loader module table would refuse
 * it); the tokens follow the harness's own settings surfaces
 * (`packages/client/ui-settings-general/src/client/SettingsRoot.module.css`
 * for the panel geometry, `ui-settings-models` for the action row).
 * @module dsh-zotero/client/ZoteroSettingsSection
 */

import type { ReactNode } from 'react'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.section` slot this page registers into is declared
// by the settings domain's client contract; importing its types rides the
// SlotMap merge into this program without a runtime dependency.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ZoteroSettingsForm } from './ZoteroSettingsForm.tsx'
import type { ZoteroCardFace } from './zotero-card-controller.ts'
import css from './ZoteroSettingsSection.module.css'

/** Props the renderer binds for the Zotero settings page. */
export type ZoteroSettingsSectionProps = PropsRuntime<'settings.section'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroCardFace>

/**
 * Render the Zotero settings page.
 * @param props - locale copy, the page snapshot, and its form actions.
 * @returns the page, or its title with an explanation while unavailable.
 */
export function ZoteroSettingsSection(props: ZoteroSettingsSectionProps): ReactNode {
  const { t } = props
  const state = props.useZoteroCard((snapshot) => snapshot)
  if (!state.available) {
    return (
      <div className={css.page}>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.status} role="status">
          {t('unavailable')}
        </p>
      </div>
    )
  }
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h2 className={css.title}>{t('title')}</h2>
        {state.dirty ? (
          <Tag tone="neutral" className={css.pending}>
            {t('unsaved')}
          </Tag>
        ) : null}
      </div>
      <p className={css.description}>{t('description')}</p>
      {state.writable ? null : (
        <p className={css.status} role="status">
          {t('readOnly')}
        </p>
      )}
      <ZoteroSettingsForm t={t} state={state} actions={props} />
      <div className={css.footer}>
        {state.failed ? (
          <p className={css.failed} role="status">
            {t('saveFailed')}
          </p>
        ) : null}
        <button
          type="button"
          className={css.discard}
          disabled={!state.dirty || state.saving}
          onClick={props.discard}
        >
          {t('discard')}
        </button>
        <button type="button" className={css.save} disabled={blocked} onClick={props.save}>
          {t(state.saving ? 'saving' : 'save')}
        </button>
      </div>
    </div>
  )
}
