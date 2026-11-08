/**
 * The workspace toolbar: the single-line compact connection and lens header.
 * Connected shows a state dot, connection note, lens tabs (文献 | 导出),
 * session literature metrics ribbon, refresh control, and diagnostic menu.
 * Failures render as one full-width error banner with diagnosis and refresh.
 * @module dsh-zotero/client/components/workspace/WorkspaceToolbar
 */

import { useState } from 'react'
import {
  Button,
  IconEllipsisOutlineMedium,
  Menu,
  SegmentedTabs,
  type SegmentedTab,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceWorkspace } from '../../../sources/model.js'
import { buildInfoOf } from '../../build-info.ts'
import { writeStatusLabel } from '../write-label.ts'
import { IconButton } from '../IconButton.tsx'
import { connectionDiagnosisOf, type ConnectionView } from './connection.ts'
import css from './workspace.module.css'

interface WorkspaceToolbarProps<TLens extends string = string> {
  readonly connection: ConnectionView
  readonly onRefresh: () => void
  readonly t: TranslateNS<'zotero'>
  readonly workspace?: SourceWorkspace
  readonly lens?: TLens
  readonly setLens?: (lens: TLens) => void
  readonly lensTabItems?: readonly [SegmentedTab<TLens>, ...SegmentedTab<TLens>[]]
}

/** The toolbar: compact header combining connection, lenses, and metrics. */
export function WorkspaceToolbar<TLens extends string = string>({
  connection,
  onRefresh,
  t,
  workspace,
  lens,
  setLens,
  lensTabItems,
}: WorkspaceToolbarProps<TLens>) {
  const [menuOpen, setMenuOpen] = useState(false)
  const failed =
    connection.kind === 'unavailable' ||
    connection.kind === 'remote-error' ||
    connection.kind === 'no-access'
  const diagnosis = failed ? connectionDiagnosisOf(connection, t) : ''
  const checkedAt =
    connection.kind === 'connected' || connection.kind === 'unavailable'
      ? connection.checkedAt
      : undefined
  const data =
    connection.kind === 'connected' || connection.kind === 'unavailable'
      ? connection.data
      : undefined

  const menuItems = [
    ...(data?.serverId !== undefined
      ? [{ id: 'serverId', label: `${t('serverIdLabel')} ${data.serverId}`, disabled: true }]
      : []),
    ...(data?.write !== undefined
      ? [
          {
            id: 'write',
            label: `${t('writeLabel')} ${writeStatusLabel(data.write, t)}`,
            disabled: true,
          },
        ]
      : []),
    ...(data?.zoteroVersion !== undefined
      ? [
          {
            id: 'zotero',
            label: `${t('zoteroVersionLabel')} ${data.zoteroVersion}`,
            disabled: true,
          },
        ]
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
      <div className={css.toolbarLeft}>
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
          <span className={css.diagnosis} title={diagnosis}>
            {diagnosis}
          </span>
        )}

        {!failed && lensTabItems !== undefined && lens !== undefined && setLens !== undefined && (
          <>
            <span className={css.toolbarDivider} />
            <div className={css.toolbarLensSeat}>
              <SegmentedTabs
                items={lensTabItems}
                value={lens}
                onChange={setLens}
                label={t('lensBarLabel')}
                size="sm"
              />
            </div>
          </>
        )}

        {!failed && workspace !== undefined && workspace.sources.length > 0 && (
          <>
            <span className={css.toolbarDivider} />
            <div className={css.metricsRibbon}>
              <span className={css.metricsPill}>
                {t('sessionMetricsBrief', {
                  sources: workspace.sourceTotal,
                  passages: workspace.evidencePassageTotal,
                  exports: workspace.exportedRefCount,
                })}
              </span>
            </div>
          </>
        )}
      </div>

      <div className={css.toolbarRight}>
        <Menu
          open={menuOpen}
          anchor={
            <IconButton
              shape="square"
              icon={<IconEllipsisOutlineMedium size={14} />}
              className={css.menuButton}
              aria-label={t('detailsLabel')}
              onClick={() => {
                setMenuOpen(!menuOpen)
              }}
            />
          }
          items={menuItems}
          onSelect={() => {
            setMenuOpen(false)
          }}
          onClose={() => {
            setMenuOpen(false)
          }}
          portal
          autoFocus
          align="end"
        />
        <Button
          variant="ghost"
          size="sm"
          className={css.refresh}
          onClick={onRefresh}
          disabled={connection.kind === 'loading' || connection.kind === 'no-access'}
        >
          {t('refresh')}
        </Button>
      </div>
    </div>
  )
}
