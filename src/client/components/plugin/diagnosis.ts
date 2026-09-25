/**
 * Localization and formatting helper for Zotero connectivity diagnosis.
 * Shared by the plugin detail card and the workspace connection strip, so a
 * raw host diagnosis never renders bare inside a localized interface.
 * @module dsh-zotero/client/components/plugin/diagnosis
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroLocaleKey } from '../../locales.ts'

export interface FormattedDiagnosis {
  readonly message: string
  readonly rawCode?: string
}

/**
 * Stable diagnosis codes that map onto a localized, actionable sentence.
 * The leading `CODE:` form is what the host status payload carries; a few
 * codes (not composed) only appear as prose and are matched by phrase.
 */
const CODE_TO_KEY: Record<string, ZoteroLocaleKey> = {
  ZOTERO_NOT_RUNNING: 'diagnosisNotRunning',
  ZOTERO_API_DISABLED: 'diagnosisApiDisabled',
  ZOTERO_API_VERSION: 'diagnosisApiVersion',
  ZOTERO_TIMEOUT: 'diagnosisTimeout',
  ZOTERO_PROVIDER_UNAVAILABLE: 'diagnosisProviderUnavailable',
  ZOTERO_CAPABILITY_UNAVAILABLE: 'diagnosisCapabilityUnavailable',
}

/** Split a leading `CODE: message` pair; a bare string is all message. */
function splitCode(raw: string): { readonly code?: string; readonly message: string } {
  const match = /^([A-Z][A-Z0-9_]*):\s*([\s\S]+)$/.exec(raw)
  if (match) return { code: match[1], message: match[2].trim() }
  return { message: raw }
}

/**
 * Format and localize a raw diagnosis string from the Zotero probe.
 * @param rawDiagnosis - the diagnosis string returned by the provider/remote.
 * @param t - localized translator for the zotero namespace.
 * @returns friendly display message and optional technical code.
 */
export function formatDiagnosis(
  rawDiagnosis: string,
  t: TranslateNS<'zotero'>,
): FormattedDiagnosis {
  if (!rawDiagnosis) {
    return { message: t('diagnosisUnknown') }
  }

  const { code, message } = splitCode(rawDiagnosis)
  const known = code !== undefined ? CODE_TO_KEY[code] : undefined
  if (known !== undefined) {
    return { message: t(known), rawCode: code }
  }

  // A known code may ride inside a longer sentence rather than as the prefix.
  for (const [candidate, key] of Object.entries(CODE_TO_KEY)) {
    if (rawDiagnosis.includes(candidate)) {
      return { message: t(key), rawCode: candidate }
    }
  }

  // Host prose without a stable code (remote.ts: service not composed).
  if (rawDiagnosis.includes('not composed')) {
    return { message: t('diagnosisNotComposed') }
  }

  if (code !== undefined) {
    return { message, rawCode: code }
  }
  return { message: rawDiagnosis }
}

/**
 * One-line, locale-first diagnosis for compact surfaces (toolbar strip).
 * @param rawDiagnosis - the diagnosis string returned by the provider/remote.
 * @param t - localized translator for the zotero namespace.
 * @returns a single readable line: label, optional code, localized message.
 */
export function diagnosisLine(rawDiagnosis: string, t: TranslateNS<'zotero'>): string {
  const formatted = formatDiagnosis(rawDiagnosis, t)
  return formatted.rawCode
    ? `${t('diagnosisLabel')} ${formatted.rawCode}: ${formatted.message}`
    : `${t('diagnosisLabel')}: ${formatted.message}`
}
