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
import css from './SourcesList.module.css'

/** The non-zero non-successful export counts as one note. */
export function incompleteExportsNoteOf(
  operations: OperationFacts,
  t: TranslateNS<'zotero'>,
): string {
  const parts: string[] = []
  if (operations.running > 0)
    parts.push(interpolate(t('runningBadge'), { count: operations.running }))
  if (operations.failed > 0) parts.push(interpolate(t('failedBadge'), { count: operations.failed }))
  if (operations.stopped > 0)
    parts.push(interpolate(t('stoppedBadge'), { count: operations.stopped }))
  return parts.join(' · ')
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
          {t('exportsIncompleteNote')}：{incomplete}
        </p>
      )}
      {workspace.exports.map((artifact, index) => (
        <ExportCard key={artifact.callId} artifact={artifact} ordinal={index + 1} t={t} />
      ))}
      <p className={css.note}>{t('exportsStaticNote')}</p>
    </div>
  )
}
