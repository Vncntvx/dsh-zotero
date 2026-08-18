/**
 * The exports page: the session-wide export artifacts lens. Only successful
 * exports appear, in session order, with the non-successful calls listed
 * separately as operations — never as achievements — and the static-export
 * disclaimer stated once.
 * @module dsh-zotero/client/components/workspace/ExportsPage
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { SourceWorkspace } from '../../sources/model.ts'
import { ExportCard } from '../ExportCard.tsx'
import { incompleteExportsNoteOf } from '../ExportsLens.tsx'
import css from './workspace.module.css'

export interface ExportsPageProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
}

/** The exports page: artifacts, incomplete operations, and the disclaimer. */
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
      <div className={css.cardStack}>
        {workspace.exports.map((artifact, index) => (
          <ExportCard key={artifact.callId} artifact={artifact} ordinal={index + 1} t={t} />
        ))}
      </div>
      {workspace.exports.length > 0 && <p className={css.note}>{t('exportsStaticNote')}</p>}
    </div>
  )
}
