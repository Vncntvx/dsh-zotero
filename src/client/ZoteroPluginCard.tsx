/**
 * The Zotero configuration card in the harness's Plugins configuration tab —
 * the same disclosure chrome the section's own cards use (Shell, Agent loop,
 * Web search): a bordered card whose header names the plugin and discloses the
 * controls in place, with a pending marker while edits are staged. The body
 * carries the namespace's full configuration form (every field, grouped into
 * the families the host schema declares).
 *
 * The card reads and writes through the harness's settings scope for the
 * `zotero` namespace (bound in the client entry); staging follows the harness
 * convention: nothing writes until Save, and the footer's Discard drops the
 * staged edits. It renders nothing while the namespace is unavailable — a
 * deployment that does not compose the host half shows no trace of it,
 * matching the native cards.
 *
 * The card chrome is spelled here rather than imported because a client bundle
 * must not value-import another plugin's code (the loader module table would
 * refuse it); the tokens and structure mirror the section's own `PluginCard`.
 * @module dsh-zotero/client/ZoteroPluginCard
 */

import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the keyed `settings.plugin.item` slot this card registers into is
// declared by the Plugins section's client contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { ZoteroSettingsForm } from './ZoteroSettingsForm.tsx'
import type { ZoteroCardFace, ZoteroCardState } from './zotero-card-controller.ts'
import css from './ZoteroPluginCard.module.css'

/** Props the renderer binds for the Zotero plugin card. */
export type ZoteroPluginCardProps = PropsRuntime<'settings.plugin.item'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroCardFace>

/**
 * Render the Zotero configuration card.
 * Collapse follows the harness PluginCard: only after Host-confirmed
 * settlement; a rejected write keeps diagnostics and drafts visible.
 * Staged edits outlive collapsing, so the header still marks them.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ZoteroPluginCard(props: ZoteroPluginCardProps) {
  const { t } = props
  const state = props.useZoteroCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)
  useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])
  if (!state.available) return null
  const title = t('title')
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={clsx(css.card, open && css.cardOpen)}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{t('description')}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{t('unsaved')}</span> : null}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>
      {open ? (
        <div className={css.body}>
          {!state.writable ? (
            <p className={css.readOnly} role="status">
              {t('readOnly')}
            </p>
          ) : null}
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
      ) : null}
    </li>
  )
}
