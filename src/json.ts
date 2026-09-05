/**
 * JSON-tolerance guards shared by the normalizers: every external API value
 * enters the domain through these narrow reads, so a malformed field is
 * treated as absent instead of crashing or being mistyped.
 * @module dsh-zotero/json
 */

import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { REF_KEY_SOURCE } from './ref-grammar.js'

const OBJECT_KEY_PATTERN = new RegExp(`^${REF_KEY_SOURCE}$`)

/** Narrow any value to a plain JSON object, or undefined. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Narrow any value to a string, or undefined. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** True when the string is a Zotero object key: 8 uppercase alphanumerics. */
export function isObjectKey(value: string): boolean {
  return OBJECT_KEY_PATTERN.test(value)
}

/**
 * Narrow any value to a lossless-JSON value, or undefined. Single entry point
 * over the harness's `isJsonValue` (which reports boolean, not a predicate),
 * so callers never repeat the `as JsonValue` narrowing comment. `isJsonValue`
 * validates without detaching, so the returned reference aliases the input's
 * sub-objects by design: all callers pass freshly parsed, single-owner API
 * payloads (the tool pipeline snapshots again downstream), and avoiding a deep
 * copy here keeps the normalizers allocation-free on the hot path.
 * @param value - candidate value to test.
 * @returns the value as lossless JSON, or undefined when it cannot round-trip.
 */
export function asJsonValue(value: unknown): JsonValue | undefined {
  return isJsonValue(value) ? (value as JsonValue) : undefined
}
