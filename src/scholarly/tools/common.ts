/**
 * Common contracts, descriptors, and helpers shared across scholarly tools.
 * @module dsh-zotero/scholarly/tools/common
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ScholarlyHttp } from '../transport/http.js'
import type { ScholarlyKeys } from '../types.js'
import type { ZoteroServiceLike } from '../zotero-link.js'

export interface ScholarlyToolHost {
  http: ScholarlyHttp
  keys(): ScholarlyKeys
  maxResults(): number
  zoteroService?(): ZoteroServiceLike | undefined
}

/** One bounded, model-readable Scholarly receipt. Text remains the human rendering. */
export const SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
      papers: { type: 'array', items: { type: 'object', additionalProperties: true } },
      citations: { type: 'array', items: { type: 'object', additionalProperties: true } },
      checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
      document: { type: 'object', additionalProperties: true },
      issues: { type: 'array', items: { type: 'string' } },
    },
  },
  render: (_args: unknown, value: { text: string }) => [
    { type: 'text' as const, text: value.text },
  ],
} as const

export type ScholarlyToolOutput = {
  text: string
  papers?: Array<Record<string, JsonValue>>
  citations?: Array<Record<string, JsonValue>>
  checks?: Array<Record<string, JsonValue>>
  document?: Record<string, JsonValue>
  issues?: string[]
}

/**
 * Recursively clean an object into pure JsonValue by removing undefined entries.
 */
export function toCleanJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map(toCleanJsonValue)
  }
  if (typeof value === 'object') {
    const res: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        res[k] = toCleanJsonValue(v)
      }
    }
    return res
  }
  return null
}

export function toCleanJsonRecord<T extends object>(item: T): Record<string, JsonValue> {
  return toCleanJsonValue(item) as Record<string, JsonValue>
}

export function toCleanJsonRecords<T extends object>(
  items: readonly T[],
): Array<Record<string, JsonValue>> {
  return items.map(toCleanJsonRecord)
}
