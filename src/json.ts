/**
 * JSON-tolerance guards shared by the normalizers: every external API value
 * enters the domain through these narrow reads, so a malformed field is
 * treated as absent instead of crashing or being mistyped.
 * @module dsh-zotero/json
 */

const OBJECT_KEY_PATTERN = /^[A-Z0-9]{8}$/

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
