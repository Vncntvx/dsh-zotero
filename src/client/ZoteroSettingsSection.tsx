/**
 * The Zotero settings page: rendered in the Plugins manager detail page
 * (`plugins.bundle.config` slot, keyed by package name), editing every field
 * of the `zotero` namespace the host half registers. The whole configuration
 * lives here: the page owns the header, the grouped form body rides the
 * harness's official `<SettingsForm>` chrome (unavailable/read-only status,
 * failed notice, save button, and discard-on-unmount), so a namespace with
 * this many fields never has to be read through a collapsed card.
 *
 * The slot declares a `view` discriminator, but `plugins.bundle.config` is
 * rendered only with `view: 'page'` (the harness page hardcodes it; `summary`
 * belongs to `plugins.item` and `plugins.row.config`), so the page has no
 * early-out and its hooks always run on every render.
 *
 * The page reads and writes through the shared configuration form
 * (`ctx.configForms.get`), staged through the harness's own
 * `SettingsFormModel`; nothing writes until Save, and leaving the page drops
 * the staged edits. While the namespace is not served to this client the page
 * still renders with its title and the form's own unavailable notice instead of
 * vanishing.
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
import { ZoteroSettingsForm } from './ZoteroSettingsForm.tsx'
import type { ZoteroCardFace } from './zotero-card-controller.ts'
import css from './ZoteroSettingsSection.module.css'

/** Props the renderer binds for the Zotero settings page in plugins.bundle.config. */
export type ZoteroSettingsSectionProps = PropsRuntime<'plugins.bundle.config'> &
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
    <div className={css.page} data-zotero-config-page>
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
