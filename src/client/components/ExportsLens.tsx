/**
 * The exports lens: only successful export artifacts, in session order,
 * with the non-successful export calls listed separately as operations —
 * never as achievements — and the static-export disclaimer stated once.
 * @module dsh-zotero/client/components/ExportsLens
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../presenters.ts'
import type { OperationFacts, SourceWorkspace } from '../sources/model.ts'
import { ExportCard } from './ExportCard.tsx'
import { operationsLabelsOf } from './operations.ts'
import css from './SourcesList.module.css'

/** The non-zero non-successful export counts as one note. */
export function incompleteExportsNoteOf(
  operations: OperationFacts,
  t: TranslateNS<'zotero'>,
): string {
  return operationsLabelsOf(operations, t).join(' · ')
}

export interface ExportsLensProps {
  readonly workspace: SourceWorkspace
  readonly t: TranslateNS<'zotero'>
}

/** The exports lens: artifacts, incomplete operations, and the disclaimer. */
export function ExportsLens({ workspace, t }: ExportsLensProps) {
  if (workspace.exports.length === 0) {
    return <p className={css.emptyNote}>{t('exportsEmptyNote')}</p>
  }
  const incomplete = incompleteExportsNoteOf(workspace.exportOperations, t)
  return (
    <div className={css.wrap}>
      {incomplete !== '' && (
        <p className={css.note}>
          {interpolate(t('exportsIncompleteNote'), { counts: incomplete })}
        </p>
      )}
      {workspace.exports.map((artifact, index) => (
        <ExportCard key={artifact.callId} artifact={artifact} ordinal={index + 1} t={t} />
      ))}
      <p className={css.note}>{t('exportsStaticNote')}</p>
    </div>
  )
}
