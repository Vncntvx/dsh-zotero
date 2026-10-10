/**
 * The Zotero settings page: one entry in the Settings panel's left navigation,
 * a sibling of General, Models, and Plugins, editing every field of the
 * `zotero` namespace the host half registers. The whole configuration lives
 * here: the page owns the header, the grouped form body rides the harness's
 * official `<SettingsForm>` chrome (unavailable/read-only status, failed
 * notice, save button, and discard-on-unmount), so a namespace with this many
 * fields never has to be read through a collapsed card.
 *
 * The page reads and writes through the shared configuration form
 * (`ctx.configForms.get`), staged through the harness's own
 * `SettingsFormModel`; nothing writes until Save, and leaving the page drops
 * the staged edits. While the namespace is not served to this client the page
 * still renders (the left-nav entry exists either way) with its title and
 * the form's own unavailable notice instead of vanishing.
 *
 * `SettingsForm` comes from `dsh-client-ui-primitives`, a platform module the
 * shell shares with every bundle (`PLATFORM_MODULES`), so value-importing it
 * is the official form, not another plugin's code.
 * @module dsh-zotero/client/ZoteroSettingsSection
 */

import { useMemo, type ReactNode } from 'react'
import { SettingsForm, type SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
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

/** The five labels the official form chrome renders, from the plugin dictionary. */
function formLabels(t: TranslateNS<'zotero'>): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/**
 * Render the Zotero settings page.
 * @param props - locale copy, the page snapshot, and its form actions.
 * @returns the page, with the official chrome around its grouped form.
 */
export function ZoteroSettingsSection(props: ZoteroSettingsSectionProps): ReactNode {
  const { t } = props
  const state = props.useZoteroCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])
  return (
    <div className={css.page}>
      <div className={css.head}>
        <h2 className={css.title}>{t('title')}</h2>
      </div>
      <p className={css.description}>{t('description')}</p>
      <SettingsForm labels={labels} state={state} onSave={props.save} onDiscard={props.discard}>
        <ZoteroSettingsForm t={t} state={state} actions={props} />
      </SettingsForm>
    </div>
  )
}
