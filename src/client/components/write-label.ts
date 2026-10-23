/**
 * The one rendering of the write-capability pair (enabled, authorized) into a
 * localized label. The three states are mutually exclusive, so every surface
 * that reports write readiness reads them from here instead of restating the
 * branch.
 *
 * @module dsh-zotero/client/write-label
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Format write capability state into a user-facing localized string.
 * @param write - The write capability state, or undefined if absent.
 * @param t - Locale translator for the zotero namespace.
 * @returns Localized status label.
 */
export function writeStatusLabel(
  write: { readonly enabled: boolean; readonly authorized: boolean } | undefined,
  t: TranslateNS<'zotero'>,
): string {
  if (write === undefined) return '-'
  if (!write.enabled) return t('writeDisabledLabel')
  return write.authorized ? t('writeAuthorizedLabel') : t('writeUnauthorizedLabel')
}
