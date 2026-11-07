/**
 * The browser controller cannot import the host's credential validation, so
 * its grammar regex and its key-field maps are pinned against what the host
 * and the harness actually accept: the reference grammar must stay
 * character-for-character `REF_PATTERN` from `@deepseek-ai/dsh-credentials`,
 * and both derived maps must agree with the shared key-field tuple the host
 * resolver walks.
 * @module tests/client/settings/credential-reference-parity
 */

import { describe, expect, it } from 'vitest'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import {
  CREDENTIAL_REFERENCE,
  SECRET_FOR_REFERENCE,
  SECRET_REF_FIELDS,
} from '../../../src/client/scholarly-form-controller.js'
import { SCHOLARLY_KEY_FIELD_PAIRS } from '../../../src/credential-names.js'

describe('credential-reference parity', () => {
  it('accepts exactly the names the harness credentials grammar accepts', () => {
    const corpus = [
      'A',
      '_x',
      'a1',
      'S2_API_KEY',
      'NCBI_API_KEY',
      'OPENALEX_API_KEY',
      'a'.repeat(64),
      // Rejections: leading digit, punctuation, empty, non-ASCII, whitespace.
      '1a',
      'a-b',
      'a.b',
      '',
      '键',
      ' A',
    ]
    for (const name of corpus) {
      expect(CREDENTIAL_REFERENCE.test(name), `client grammar for ${JSON.stringify(name)}`).toBe(
        isCredentialRefName(name),
      )
    }
  })

  it('derives both maps from the shared key-field tuple the host resolver walks', () => {
    for (const [secret, reference] of SCHOLARLY_KEY_FIELD_PAIRS) {
      expect(SECRET_REF_FIELDS[secret]).toBe(reference)
      expect(SECRET_FOR_REFERENCE[reference]).toBe(secret)
    }
    expect(Object.keys(SECRET_REF_FIELDS)).toHaveLength(SCHOLARLY_KEY_FIELD_PAIRS.length)
    expect(Object.keys(SECRET_FOR_REFERENCE)).toHaveLength(SCHOLARLY_KEY_FIELD_PAIRS.length)
  })
})
