/**
 * The workspace empty state: shown before the session has made any Zotero
 * call. The starter pills only prefill the composer (setDraft) — never
 * submit — and every starter names something the plugin can actually do.
 * @module dsh-zotero/client/components/workspace/WorkspaceEmptyState
 */

import { IconBrowseOutline16, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './workspace.module.css'

export interface WorkspaceEmptyStateProps {
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
}

/** The prefill-only starter pills of the empty workspace. */
export function WorkspaceEmptyState({ t, setDraft }: WorkspaceEmptyStateProps) {
  return (
    <div className={css.empty}>
      <IconBrowseOutline16 size={16} className={css.emptyIcon} />
      <p className={css.emptyText}>{t('noSources')}</p>
      {setDraft !== undefined && (
        <div className={css.starterRow}>
          <Pill
            onClick={() => {
              setDraft(t('starterFindTemplate'))
            }}
          >
            {t('starterFind')}
          </Pill>
          <Pill
            onClick={() => {
              setDraft(t('starterCompareTemplate'))
            }}
          >
            {t('starterCompare')}
          </Pill>
          <Pill
            onClick={() => {
              setDraft(t('starterEvidenceTemplate'))
            }}
          >
            {t('starterEvidence')}
          </Pill>
          <Pill
            onClick={() => {
              setDraft(t('starterExportSelectedTemplate'))
            }}
          >
            {t('starterExportSelected')}
          </Pill>
        </div>
      )}
    </div>
  )
}
