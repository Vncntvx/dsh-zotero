/**
 * The artifact id's admission rule and its compile-time brand.
 *
 * An artifact id and a content fingerprint are both 64-character lowercase
 * hex strings. The brand is what keeps one from being passed where the other
 * belongs: the read seam that resolves an artifact id would otherwise
 * receive a fingerprint and answer "the artifact no longer exists", which is
 * a misleading failure for a caller's mix-up. The `@ts-expect-error` lines
 * are the assertion — removing the brand from `ArtifactId` turns them into
 * unused-expectation errors, and widening the seam back to `string` makes
 * them compile, both of which fail `npm run typecheck`.
 * @module tests/unit/artifact-id
 */

import { describe, expect, it } from 'vitest'
import { artifactIdOf, type ArtifactId } from '../../src/contract.js'

describe('artifactIdOf', () => {
  it('admits the store spelling and returns the same value', () => {
    const value = 'a1b2c3d4'.repeat(8)
    const id = artifactIdOf(value)
    expect(id).toBe(value)
  })

  it.each([
    { name: 'short', value: 'a'.repeat(63) },
    { name: 'long', value: 'a'.repeat(65) },
    { name: 'uppercase', value: 'A'.repeat(64) },
    { name: 'non-hex', value: 'g'.repeat(64) },
    { name: 'blank', value: '' },
  ])('refuses a $name id instead of branding it', ({ value }) => {
    expect(artifactIdOf(value)).toBeUndefined()
  })

  it('keeps an artifact id and a fingerprint non-interchangeable', () => {
    const fingerprint = 'f'.repeat(64)
    // @ts-expect-error a plain string is not an admitted artifact id.
    const forged: ArtifactId = fingerprint
    expect(forged).toBe(fingerprint)
    // The only way to make one is the admission point, which proves syntax.
    const admitted = artifactIdOf(fingerprint)
    expect(admitted).toBe(fingerprint)
  })
})
