/**
 * The inspector's exports panel: the selected source's exported documents
 * as per-format rows, the same surface as the session-wide exports page. The
 * panel tab already carries the count, so the rows speak for themselves.
 * @module dsh-zotero/client/components/workspace/SourceExports
 */

import { useMemo } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SourceItem } from '../../../sources/model.js'
import { sourceExportsOf } from '../../sources/selectors.ts'
import { ExportSections } from '../ExportSections.tsx'
import { SourcePageControls } from './SourcePageControls.tsx'
import type { SourcePager } from './useSourcePage.ts'
import css from './workspace.module.css'

interface SourceExportsProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  /** The pager that appends the exports behind the list's head. */
  readonly pager?: SourcePager
}

/** The exports panel: one document row per export of the selected source. */
export function SourceExports({ item, t, pager }: SourceExportsProps) {
  const exports = useMemo(() => sourceExportsOf(item.exports, item.ref), [item.exports, item.ref])
  if (exports.length === 0) {
    return (
      <div className={css.panel}>
        <p className={css.note}>
          {item.exportsTotal === 0 ? t('exportsEmptyNote') : t('sourceExportsUnavailable')}
        </p>
      </div>
    )
  }
  return (
    <div className={css.panel}>
      <ExportSections exports={exports} t={t} />
      {item.exportsTotal > item.exports.length && (
        <p className={css.note}>{t('exportsOmittedNote', { count: item.exportsTotal })}</p>
      )}
      {exports.length < item.exports.length && (
        <p className={css.note}>
          {t('sourceExportsIsolatedNote', { count: item.exports.length - exports.length })}
        </p>
      )}
      {pager !== undefined && <SourcePageControls pager={pager} label={t('panelExports')} t={t} />}
    </div>
  )
}
