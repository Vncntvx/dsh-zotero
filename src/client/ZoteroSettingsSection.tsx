/**
 * The Zotero settings page: rendered in the Plugins manager detail page
 * (`plugins.bundle.config` slot, keyed by package name). It edits every field
 * of the `zotero` namespace the host half registers.
 *
 * The slot declares a `view` discriminator, but `plugins.bundle.config` is
 * rendered only with `view: 'page'`: the slot's own contract says
 * "`view: 'page'` only" (`summary` belongs to `plugins.item` and
 * `plugins.row.config`), and the plugin manager page has exactly one
 * `renderSlot` call for it, which passes `view: 'page'`. So the page has no
 * early-out and its hooks always run on every render.
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
export function formLabels(t: TranslateNS<'zotero'>): SettingsFormLabels {
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
  const zoteroState = props.useZoteroCard((snapshot) => snapshot)
  const labels = useMemo(() => formLabels(t), [t])

  return (
    <div className={css.page} data-zotero-config-page>
      <div className={css.head}>
        <h2 className={css.title}>{t('title')}</h2>
      </div>
      <p className={css.description}>{t('description')}</p>
      <SettingsForm
        labels={labels}
        state={zoteroState}
        onSave={props.save}
        onDiscard={props.discard}
      >
        <ZoteroSettingsForm t={t} state={zoteroState} actions={props} />
      </SettingsForm>
    </div>
  )
}
