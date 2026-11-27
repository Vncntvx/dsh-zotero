/**
 * Shared identity and text rules used by Zotero record normalizers.
 * @module dsh-zotero/normalize-context
 */

import { asRecord, asString, detachUtf16, isObjectKey } from './json.js'
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

export function normalizeTags(data: Record<string, unknown> | undefined): string[] {
  const rawTags = Array.isArray(data?.tags) ? data.tags : []
  const tags: string[] = []
  for (const raw of rawTags) {
    const tag = asString(asRecord(raw)?.tag)
    if (tag !== undefined && tag !== '') tags.push(tag)
  }
  return tags
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

export function itemTitleOf(data: Record<string, unknown> | undefined, itemType: string): string {
  const title = asString(data?.title) ?? ''
  if (itemType !== 'note' || title !== '') return title
  return (
    plainNoteText(data?.note)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '(untitled note)'
  )
}

export function truncateText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  let end = max
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--
  // The cut detaches the excerpt so a previewed abstract or note in tool
  // meta does not pin the full field it came from.
  return { text: detachUtf16(text.slice(0, end)), truncated: true }
}
