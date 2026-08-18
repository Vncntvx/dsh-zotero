/**
 * The inspector's exports panel: the selected source's exported documents
 * as per-format rows — same surface as the session-wide exports page. The
 * panel tab already carries the count, so the rows speak for themselves.
 * @module dsh-zotero/client/components/workspace/SourceExports
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceItem } from '../../sources/model.ts'
import { ExportSections } from '../ExportSections.tsx'
import css from './workspace.module.css'

export interface SourceExportsProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** The exports panel: one document row per export of the selected source. */
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
      <ExportSections exports={item.exports} t={t} />
    </div>
  )
}
