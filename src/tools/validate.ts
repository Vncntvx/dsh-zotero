/**
 * Shared argument validation for the model-facing tools. Domain constraints
 * the JSON schemas cannot express fail here with a typed argument error;
 * every message is model-facing and names the offending value.
 * @module dsh-zotero/tools/validate
 */

import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import { parseRef, requireSupportedLocalRef } from '../refs.js'
import type { ZoteroKind, ZoteroObjectRef, SupportedLocalLibrary } from '../types.js'

/** The item-ref format the tool descriptions state verbatim, so the tools cannot drift apart. */
export const REF_ARG_HINT = 'zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY>'

/** Throw an argument error; the message is model-facing. */
export function invalid(message: string): never {
  throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT)
}

/**
 * Assert an integer within `[min, max]`, naming the argument and its value.
 * @param name - the argument name shown in the message.
 * @param value - the candidate value.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 */
export function assertIntInRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    invalid(`${name} must be an integer between ${min} and ${max}; got ${value}`)
  }
}

/**
 * Parse a model-provided ref string and gate it on the supported local
 * libraries plus the allowed object kinds — the shared entry every tool
 * uses to turn a `zotero://` argument into a domain ref.
 * @param value - the raw ref string argument.
 * @param kinds - allowed kinds; omit to accept any parsed kind.
 * @throws {ZoteroError} `ZOTERO_INVALID_REF` outside the grammar or contract.
 */
export function parseSupportedRef(value: string, kinds?: readonly ZoteroKind[]): ZoteroObjectRef {
  return requireSupportedLocalRef(parseRef(value), kinds)
}

/**
 * Parse the optional `library` tool argument. Absent stays absent; a
 * malformed shape fails closed instead of silently defaulting.
 * @throws {ZoteroError} `ZOTERO_INVALID_ARGUMENT` on a non-local library shape.
 */
export function parseLibrary(value: unknown): SupportedLocalLibrary | undefined {
  if (value === undefined || value === null) return undefined
  const rec = value as Record<string, unknown>
  const type = rec.type
  const id = rec.id
  if (type !== 'user' && type !== 'group') invalid('library.type must be user or group')
  if (!Number.isInteger(id)) invalid('library.id must be integer')
  if (type === 'user' && id !== 0) invalid('Only user/0 is supported for personal library')
  if (type === 'group' && (id as number) <= 0) invalid('group id must be positive integer')
  return { type: type as SupportedLocalLibrary['type'], id: id as number } as SupportedLocalLibrary
}
