/** Bounds authored write fields and encoded request bytes before approval or dispatch. */
import { invalidArgs } from './errors.js'

export const WRITE_PAYLOAD_MAX_BYTES = 1_048_576

/** Count JSON in bounded chunks so an oversized field never requires a full encoded copy. */
export function assertWritePayload(
  value: unknown,
  maxChars = WRITE_PAYLOAD_MAX_BYTES,
  noteMaxChars = maxChars,
): void {
  let bytes = 0
  const active = new Set<object>()
  const count = (text: string): void => {
    bytes += new TextEncoder().encode(text).byteLength
    if (bytes > WRITE_PAYLOAD_MAX_BYTES)
      invalidArgs(`The write request exceeds the ${WRITE_PAYLOAD_MAX_BYTES}-byte payload limit.`)
  }
  const string = (text: string, limit: number): void => {
    if (text.length > limit) invalidArgs(`A write field exceeds its ${limit}-character bound.`)
    count('""')
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + 4096)
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--
      count(JSON.stringify(text.slice(start, end)).slice(1, -1))
      start = end
    }
  }
  const visit = (entry: unknown, key: string, depth: number): void => {
    if (depth > 64) invalidArgs('The write request exceeds the 64-level nesting limit.')
    if (typeof entry === 'string') string(entry, key === 'markdown' ? noteMaxChars : maxChars)
    else if (entry !== null && typeof entry === 'object') {
      if (active.has(entry)) invalidArgs('The write request contains a circular reference.')
      active.add(entry)
      count('[]')
      let first = true
      const member = (value: unknown, field: string): void => {
        if (!first) count(',')
        first = false
        visit(value, field, depth + 1)
      }
      if (Array.isArray(entry)) {
        for (const value of entry) member(value ?? null, '')
      } else {
        for (const [field, value] of Object.entries(entry)) {
          if (value === undefined) continue
          if (!first) count(',')
          first = false
          string(field, WRITE_PAYLOAD_MAX_BYTES)
          count(':')
          visit(value, field, depth + 1)
        }
      }
      active.delete(entry)
    } else if (entry === null || typeof entry === 'boolean' || typeof entry === 'number') {
      count(JSON.stringify(entry))
    } else invalidArgs('Write requests must contain JSON values.')
  }
  visit(value, '', 0)
}

/** The transport enforces the aggregate bound even for callers below the service seam. */
export function stringifyWriteBody(value: unknown): string {
  assertWritePayload(value)
  return JSON.stringify(value)
}
