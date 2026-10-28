/**
 * Field specs the harness does not ship. Upstream provides number and text
 * fields only; the boolean toggle's spec lives here in the
 * `SettingsFieldSpec` shape, and every settings form stages through it.
 * @module dsh-zotero/client/helpers/settings-fields
 */

import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * A boolean field: the draft is the literal 'true'/'false' text a toggle
 * control maps to a checked state. An empty draft clears the field.
 * @param field - field name inside the settings section.
 * @returns the field's conversion spec.
 */
export function booleanFieldSpec(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'boolean' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      if (trimmed === 'true') return { kind: 'set', value: true }
      if (trimmed === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}
