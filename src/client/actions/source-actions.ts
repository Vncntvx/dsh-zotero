/**
 * The composer prefill templates for one item. Prefills go through the
 * injected inputActions.setDraft and never submit; the host offers no
 * direct tool dispatch from the web UI.
 * @module dsh-zotero/client/actions/source-actions
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate } from '../presenters.ts'

/** The ask-about prefill for one item's ref. */
export function askDraftOf(ref: string, t: TranslateNS<'zotero'>): string {
  return interpolate(t('askTemplate'), { ref })
}

/** The export prefill for one item's ref. */
export function exportDraftOf(ref: string, t: TranslateNS<'zotero'>): string {
  return interpolate(t('citeTemplate'), { ref })
}
