/**
 * Shared identity and text rules used by Zotero record normalizers.
 * @module dsh-zotero/normalize-context
 */

import { asString, isObjectKey } from './json.js'
import type { SupportedLocalLibrary } from './types.js'

export interface NormalizeContext {
  readonly library: SupportedLocalLibrary
  readonly serverId?: string
}

const PERSONAL_CONTEXT: NormalizeContext = { library: { type: 'user', id: 0 } }

export function resolveNormalizeContext(context?: NormalizeContext): NormalizeContext {
  return context ?? PERSONAL_CONTEXT
}

export const ITEM_WITHOUT_KEY_MESSAGE = 'Zotero returned an item without a valid object key.'

export function parentKeyOf(data: Record<string, unknown> | undefined): string | undefined {
  const parentKey = asString(data?.parentItem)
  return parentKey !== undefined && isObjectKey(parentKey) ? parentKey : undefined
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&amp;': '&',
}
const HTML_ENTITY_PATTERN = /&(?:nbsp|lt|gt|quot|#39|apos|amp);/gi

export function plainNoteText(value: unknown): string {
  const raw = asString(value) ?? ''
  if (raw === '') return ''
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|li|div|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(HTML_ENTITY_PATTERN, (match) => HTML_ENTITIES[match.toLowerCase()] ?? match)
    .trim()
}

export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  return text.length > max
    ? { text: text.slice(0, max), truncated: true }
    : { text, truncated: false }
}
