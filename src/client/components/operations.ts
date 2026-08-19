/**
 * The shared operation-count labels: one non-zero count per kind, in the
 * panel's fixed order (running, failed, stopped). Every surface that shows
 * operation facts — row badges, the dossier, and the exports lens — renders
 * these same labels so the vocabulary cannot drift.
 * @module dsh-zotero/client/components/operations
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../presenters.ts'
import type { OperationFacts } from '../sources/model.ts'

/** The non-zero operation labels of one operation-facts record, in fixed order. */
function operationsLabelsOf(operations: OperationFacts, t: TranslateNS<'zotero'>): string[] {
  const labels: string[] = []
  if (operations.running > 0)
    labels.push(interpolate(t('runningBadge'), { count: operations.running }))
  if (operations.failed > 0)
    labels.push(interpolate(t('failedBadge'), { count: operations.failed }))
  if (operations.stopped > 0)
    labels.push(interpolate(t('stoppedBadge'), { count: operations.stopped }))
  return labels
}

/** The non-zero non-successful export counts as one middot-joined note. */
export function incompleteExportsNoteOf(
  operations: OperationFacts,
  t: TranslateNS<'zotero'>,
): string {
  return operationsLabelsOf(operations, t).join(' · ')
}
