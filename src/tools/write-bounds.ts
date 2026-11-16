/** Applies scalar and payload bounds to every write request before approval. */
import { invalidArgs } from '../errors.js'

export function assertWritePayload(value: unknown, maxChars: number, maxBytes = 1_048_576): void {
  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string' && current.length > maxChars)
      invalidArgs(`${path} exceeds the ${maxChars}-character bound (write field limit).`)
    if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, `${path}[${index}]`))
    else if (current !== null && typeof current === 'object')
      Object.entries(current).forEach(([key, entry]) => visit(entry, `${path}.${key}`))
  }
  visit(value, 'write')
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes)
    invalidArgs(`The write request exceeds the ${maxBytes}-byte payload limit.`)
}
