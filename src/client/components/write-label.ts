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
