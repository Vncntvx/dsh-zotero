/**
 * The workspace toolbar: the single-line connection strip. Connected shows a
 * green dot plus the connected note, a refresh action, and a `···` menu
 * (primitives Menu in portal mode — the workspace panes scroll, so an
 * in-place list would be clipped) carrying the diagnostic facts (Server ID,
 * API/schema versions, last checked time, build identity). Failures render
 * as one full-width error banner instead of a developer console: the
 * diagnosis line is the whole story, and the refresh action sits beside it.
 * @module dsh-zotero/client/components/workspace/WorkspaceToolbar
 */

import { useState } from 'react'
import { Menu, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { buildInfoOf } from '../../build-info.ts'
import { connectionDiagnosisOf, type ConnectionView } from './connection.ts'
import css from './workspace.module.css'

export interface WorkspaceToolbarProps {
  readonly connection: ConnectionView
  readonly onRefresh: () => void
  readonly t: TranslateNS<'zotero'>
}

/** The toolbar: connection strip with the diagnostic menu and refresh. */
export function WorkspaceToolbar({ connection, onRefresh, t }: WorkspaceToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const failed = connection.kind === 'unavailable' || connection.kind === 'remote-error'
  const checkedAt =
    connection.kind === 'connected' || connection.kind === 'unavailable'
      ? connection.checkedAt
      : undefined
  const data = connection.kind === 'connected' ? connection.data : undefined

  const menuItems = [
    ...(data?.serverId !== undefined
      ? [{ id: 'serverId', label: `${t('serverIdLabel')} ${data.serverId}`, disabled: true }]
      : []),
    ...(data?.apiVersion !== undefined
      ? [{ id: 'api', label: `${t('apiVersionLabel')} ${data.apiVersion}`, disabled: true }]
      : []),
    ...(data?.schemaVersion !== undefined
      ? [
          {
            id: 'schema',
            label: `${t('schemaVersionLabel')} ${data.schemaVersion}`,
            disabled: true,
          },
        ]
      : []),
    ...(checkedAt !== undefined
      ? [{ id: 'checked', label: `${t('lastCheckedLabel')} ${checkedAt}`, disabled: true }]
      : []),
    { id: 'build', label: `${t('buildInfoLabel')} ${buildInfoOf()}`, disabled: true },
  ]

  return (
    <div
      className={css.toolbar}
      role="status"
      aria-live="polite"
      aria-busy={connection.kind === 'loading'}
    >
      <StateDot
        state={
          connection.kind === 'loading'
            ? 'ongoing'
            : connection.kind === 'connected'
              ? 'done'
              : 'error'
        }
      />
      <span className={css.statusText}>
        {connection.kind === 'loading' && t('checking')}
        {connection.kind === 'connected' && t('statusConnectedNote')}
        {failed && t('statusUnavailable')}
      </span>
      {failed && (
        <span className={css.diagnosis} title={connectionDiagnosisOf(connection, t)}>
          {connectionDiagnosisOf(connection, t)}
        </span>
      )}{' '}
      <span className={css.spacer} />
      <Menu
        open={menuOpen}
        anchor={
          <button
            type="button"
            className={css.menuButton}
            aria-label={t('detailsLabel')}
            onClick={() => {
              setMenuOpen(!menuOpen)
            }}
          >
            ···
          </button>
        }
        items={menuItems}
        onSelect={() => {
          setMenuOpen(false)
        }}
        onClose={() => {
          setMenuOpen(false)
        }}
        portal
        align="end"
      />
      <button
        type="button"
        className={css.refresh}
        onClick={onRefresh}
        disabled={connection.kind === 'loading'}
      >
        {t('refresh')}
      </button>
    </div>
  )
}
