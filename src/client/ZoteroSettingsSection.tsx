/**
 * The Zotero settings page: a sibling of General, Models, and Plugins inside
 * the harness's Settings panel, editing every field of the `zotero` namespace
 * with the same staged form the harness's own plugin cards use (stage locally,
 * write only on save, mark user-layer presence as overridden).
 *
 * The page registers into `settings.section` — a plain UI slot with no
 * namespace-exposure requirements — and reads and writes through the plugin's
 * own Typert Remote endpoints, so it works in an unmodified harness. While
 * the namespace is unavailable (no settings service composed), the page shows
 * its title and an explanation instead of vanishing.
 *
 * Styling follows the harness's own settings surfaces: the official primitives
 * `Button` (primary variant) and `Input` controls, the shared `--dsw-alias-*`
 * tokens for the rest, and fields grouped into the same families the host
 * schema groups (`src/config.ts`) so a long config stays scannable.
 * @module dsh-zotero/client/ZoteroSettingsSection
 */

import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `settings.section` slot this page registers into is declared
// by the settings domain's client contract; importing its types rides the
// SlotMap merge into this program without a runtime dependency.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ValueField } from './fields.tsx'
import {
  FIELD_GROUPS,
  NUMERIC_FIELD_KEYS,
  type FieldKey,
  type ZoteroCardFace,
  type ZoteroCardState,
} from './zotero-card-controller.ts'
import type { ZoteroLocaleKey } from './locales.ts'

/** Props the renderer binds for the Zotero settings page. */
export type ZoteroSettingsSectionProps = PropsRuntime<'settings.section'> &
  PropsLocale<'zotero'> &
  InjectFace<ZoteroCardFace>

const page: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  maxWidth: 640,
  boxSizing: 'border-box',
  padding: '4px 2px',
}

const title: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 20,
  fontWeight: 600,
  lineHeight: 1.3,
}

const description: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
  lineHeight: 1.5,
}

const status: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 13,
}

const group: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}

const groupTitle: CSSProperties = {
  margin: 0,
  padding: '10px 0 4px',
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const fields: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const footer: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
  paddingTop: 12,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}

const failed: CSSProperties = {
  margin: 0,
  flex: 1,
  color: 'var(--dsw-alias-label-error)',
  fontSize: 12,
}

/**
 * Render the Zotero settings page.
 * @param props - locale copy, the page snapshot, and its form actions.
 * @returns the page, or its title with an explanation while unavailable.
 */
export function ZoteroSettingsSection(props: ZoteroSettingsSectionProps) {
  const { t } = props
  const state = props.useZoteroCard((snapshot) => snapshot)
  if (!state.available) {
    return (
      <div style={page}>
        <h2 style={title}>{t('title')}</h2>
        <p style={status} role="status">
          {state.loading ? t('loading') : t('unavailable')}
        </p>
      </div>
    )
  }
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <div style={page}>
      <h2 style={title}>{t('title')}</h2>
      <p style={description}>{t('description')}</p>
      {disabled ? (
        <p style={status} role="status">
          {t('readOnly')}
        </p>
      ) : null}
      {FIELD_GROUPS.map(({ key: groupKey, fields: keys }) => (
        <section key={groupKey} style={group} aria-label={t(groupKey)}>
          <h3 style={groupTitle}>{t(groupKey)}</h3>
          <div style={fields}>
            {keys.map((key) => field(props, state, key, t, disabled, NUMERIC_FIELD_KEYS.has(key)))}
          </div>
        </section>
      ))}
      <div style={footer}>
        {state.failed ? (
          <p style={failed} role="status">
            {t('saveFailed')}
          </p>
        ) : null}
        <Button variant="primary" size="md" disabled={blocked} onClick={props.save}>
          {t(state.saving ? 'saving' : 'save')}
        </Button>
      </div>
    </div>
  )
}

/**
 * One field control bound to the page's state and actions.
 * @param props - the bound page props (actions come from the inject face).
 * @param state - the page snapshot.
 * @param key - the field key, naming both the copy and the state member.
 * @param t - locale reader.
 * @param disabled - whether the document accepts writes.
 * @param numeric - whether the control hints a numeric keypad.
 * @returns the labelled control.
 */
function field(
  props: ZoteroSettingsSectionProps,
  state: ZoteroCardState,
  key: FieldKey,
  t: (key: ZoteroLocaleKey) => string,
  disabled: boolean,
  numeric: boolean,
): ReactNode {
  return (
    <ValueField
      key={key}
      id={`zotero-settings-${key}`}
      label={t(key)}
      hint={t(`${key}Hint`)}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={t('invalidNumber')}
      numeric={numeric}
      disabled={disabled}
      {...state[key]}
      onEdit={(text) => {
        props.edit(key, text)
      }}
      onReset={() => {
        props.resetField(key)
      }}
    />
  )
}
