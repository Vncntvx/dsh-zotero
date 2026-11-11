/**
 * Two schemastery idioms shared by component configs: a closed choice over
 * frozen values, and unwrapping a volatile reference to its live value. One
 * definition keeps the three config schemas consistent in how they read a
 * committed field.
 * @module dsh-zotero/schema-helpers
 */

import type { Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import Schema from '@deepseek-ai/schemastery'

/** A closed schema over the given values, in order. */
export const schemaChoices = (values: readonly (string | number)[]) =>
  Schema.union(values.map((value) => Schema.const(value)))

/** Read one config field's current value, unwrapping a volatile reference. */
export function currentVolatile<T>(value: T | Volatile<T> | undefined): T | undefined {
  if (value === undefined || value === null) return undefined
  return (isVolatile(value) ? value.get() : value) as T
}
