/**
 * The exports page: the session-wide exports lens over the successful
 * artifacts. Per-format sections of deduplicated documents — the format
 * head names the count and carries the copy-all / download-all actions —
 * with the non-successful calls listed separately as operations, never as
 * achievements. The static-export disclaimer lives in the README, not here:
 * a capability boundary is not something to restate under every success.
 * @module dsh-zotero/client/components/workspace/ExportsPage
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { SourceWorkspace } from '../../sources/model.ts'
import { incompleteExportsNoteOf } from '../operations.ts'
import { ExportSections } from '../ExportSections.tsx'
import css from './workspace.module.css'

export interface ExportsPageProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
}

/** The exports page: format sections and the incomplete-operations note. */
export function ExportsPage({ workspace, t }: ExportsPageProps) {
  const incomplete = incompleteExportsNoteOf(workspace.exportOperations, t)
  return (
    <div className={css.exportsPage}>
      {workspace.exports.length === 0 && <p className={css.note}>{t('exportsEmptyNote')}</p>}
      {incomplete !== '' && (
        <p className={css.note}>
          {interpolate(t('exportsIncompleteNote'), { counts: incomplete })}
        </p>
      )}
      <ExportSections exports={workspace.exports} t={t} />
    </div>
  )
}
