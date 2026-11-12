/**
 * The labels one search occurrence carries on the workspace panel.
 *
 * They live in their own module because the panel and the audit trail both
 * render them; keeping them inside a component made the panel the only
 * importable home for two strings, which is how a dead component kept a
 * production import alive.
 * @module dsh-zotero/client/components/workspace/source-labels
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SearchOccurrence } from '../../../sources/model.js'

/** The display label of one search mode. */
export function modeLabelOf(mode: 'metadata' | 'everything', t: TranslateNS<'zotero'>): string {
  return mode === 'everything' ? t('modeEverything') : t('modeMetadata')
}

/** The display label of one search scope; unnamed scopes fall back to a short ref. */
export function scopeLabelOf(scope: SearchOccurrence['scope'], t: TranslateNS<'zotero'>): string {
  switch (scope.kind) {
    case 'library':
      return t('overviewScopeLibrary')
    case 'publications':
      return t('overviewScopePublications')
    case 'collection':
      return scope.name ?? scope.ref ?? t('overviewScopeCollection')
    case 'savedSearch':
      return scope.name ?? scope.ref ?? t('overviewScopeSavedSearch')
  }
}

/** The active filters of one occurrence, joined for one line. */
export function filterLineOf(
  itemTypes: readonly string[],
  tags: readonly string[],
  _t: TranslateNS<'zotero'>,
): string {
  const parts = [...itemTypes, ...tags]
  return parts.length === 0 ? '' : parts.join(' · ')
}
