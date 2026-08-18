/**
 * The inspector's exports panel: the selected source's export artifacts.
 * Each artifact card shows the format and scope facts, the bounded ref
 * list, the BibTeX keys, and the collapsible body with a copy action.
 * @module dsh-zotero/client/components/workspace/SourceExports
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../../presenters.ts'
import type { SourceItem } from '../../sources/model.ts'
import { ExportCard } from '../ExportCard.tsx'
import css from './workspace.module.css'

export interface SourceExportsProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** The exports panel: one card per artifact of the selected source. */
export function SourceExports({ item, t }: SourceExportsProps) {
  if (item.exports.length === 0) {
    return (
      <div className={css.panel}>
        <p className={css.note}>{t('exportsEmptyNote')}</p>
      </div>
    )
  }
  return (
    <div className={css.panel}>
      <p className={css.note}>
        {interpolate(t('exportsInDetail'), { count: item.exports.length })}
      </p>
      <div className={css.cardStack}>
        {item.exports.map((artifact, index) => (
          <ExportCard key={artifact.callId} artifact={artifact} ordinal={index + 1} t={t} />
        ))}
      </div>
    </div>
  )
}
