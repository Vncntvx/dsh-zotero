/**
 * The exports page: the session-wide export artifacts lens. Only successful
 * exports appear, as disclosure rows in session order, with the
 * non-successful calls listed separately as operations — never as
 * achievements. The static-export disclaimer lives in the README, not here:
 * a capability boundary is not something to restate under every success.
 * @module dsh-zotero/client/components/workspace/ExportsPage
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { SourceWorkspace } from '../../sources/model.ts'
import { incompleteExportsNoteOf } from '../operations.ts'
import { ExportCard } from '../ExportCard.tsx'
import css from './workspace.module.css'

export interface ExportsPageProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
}

/** The exports page: artifact rows and the incomplete-operations note. */
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
      <div className={css.exportStack}>
        {workspace.exports.map((artifact) => (
          <ExportCard key={artifact.callId} artifact={artifact} t={t} />
        ))}
      </div>
    </div>
  )
}
