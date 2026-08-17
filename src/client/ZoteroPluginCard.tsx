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

import { useState, type CSSProperties } from 'react'
import { Button, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the keyed `settings.plugin.item` slot this card registers into is
// declared by the Plugins section's client contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { ZoteroSettingsForm } from './ZoteroSettingsForm.tsx'
import type { ZoteroCardFace, ZoteroCardState } from './zotero-card-controller.ts'

/** Props the renderer binds for the Zotero plugin card. */
export type ZoteroPluginCardProps = PropsRuntime<'settings.plugin.item'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroCardFace>

const card: CSSProperties = {
  listStyle: 'none',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)',
}

/** An open card reads as the one being worked on, not merely taller. */
const cardOpen: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-2)',
  borderColor: 'var(--dsw-alias-label-dimmed)',
}

const header: CSSProperties = {
  width: '100%',
  appearance: 'none',
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
}

/** Name over description: the description is what tells two plugins apart. */
const headText: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const name: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--dsw-alias-label-primary)',
}

const description: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const chevron: CSSProperties = {
  flex: 'none',
  color: 'var(--dsw-alias-label-tertiary)',
}

/** Carried on the header so a collapsed card still says it holds edits. */
const pending: CSSProperties = {
  flex: 'none',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  lineHeight: '17px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
}

const body: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  margin: '0 16px',
  padding: '12px 0 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const readOnly: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-tertiary)',
}

const footer: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  paddingTop: 12,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

const failed: CSSProperties = {
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: 'var(--dsw-alias-label-error)',
}

/**
 * Render the Zotero configuration card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ZoteroPluginCard(props: ZoteroPluginCardProps) {
  const { t } = props
  const state = props.useZoteroCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null
  const title = t('title')
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li style={open ? { ...card, ...cardOpen } : card}>
      <button
        type="button"
        style={header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span style={headText}>
          <span style={name}>{title}</span>
          <span style={description}>{t('description')}</span>
        </span>
        {state.dirty ? <span style={pending}>{t('unsaved')}</span> : null}
        <span style={open ? { ...chevron, transform: 'rotate(180deg)' } : chevron}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open ? (
        <div style={body}>
          {!state.writable ? (
            <p style={readOnly} role="status">
              {t('readOnly')}
            </p>
          ) : null}
          <ZoteroSettingsForm t={t} state={state} actions={props} />
          <div style={footer}>
            {state.failed ? (
              <p style={failed} role="status">
                {t('saveFailed')}
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={!state.dirty || state.saving}
              onClick={props.discard}
            >
              {t('discard')}
            </Button>
            <Button variant="primary" size="sm" disabled={blocked} onClick={props.save}>
              {t(state.saving ? 'saving' : 'save')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
