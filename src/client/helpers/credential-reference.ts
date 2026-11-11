/**
 * The credential-reference grammar both settings controllers share, and the
 * staged field spec that validates one. One definition, so the client cannot
 * drift from the host's `role('credential-ref')` grammar or from the other
 * form.
 * @module dsh-zotero/client/helpers/credential-reference
 */

import type { SettingsFieldSpec } from '@deepseek-ai/dsh-client-ui-primitives'

/** A POSIX-style environment-variable name, mirroring the host's grammar. */
export const CREDENTIAL_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One credential answer, reduced to the two facts a form renders. */
export interface CredentialInfo {
  readonly configured: boolean
  readonly writable: boolean
}

/** The staged field spec for one credential-reference text input. */
export function credentialRefFieldSpec(field: string): SettingsFieldSpec {
  return {
    field,
    format: (value) => (typeof value === 'string' ? value : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      return CREDENTIAL_REFERENCE.test(trimmed) ? { kind: 'set', value: trimmed } : undefined
    },
  }
}
