/**
 * Plain source actions: the copyable citation line and the composer prefill
 * templates. Prefills go through the injected inputActions.setDraft and
 * never submit; the host offers no direct tool dispatch from the web UI.
 * @module dsh-zotero/client/actions/source-actions
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate, joinNonEmpty } from '../presenters.ts'
import type { SourceItem } from '../sources/model.ts'

/** One plain-text citation line (creators, year, title, venue). */
export function citationLineOf(item: SourceItem): string {
  return joinNonEmpty(
    item.creators === undefined ? '' : `${item.creators}.`,
    item.year,
    item.title,
    item.venue === undefined ? '' : `${item.venue}.`,
  )
}

/** The ask-about prefill for one item's ref. */
export function askDraftOf(ref: string, t: TranslateNS<'zotero'>): string {
  return interpolate(t('askTemplate'), { ref })
}

/** The export prefill for one item's ref. */
export function exportDraftOf(ref: string, t: TranslateNS<'zotero'>): string {
  return interpolate(t('citeTemplate'), { ref })
}
