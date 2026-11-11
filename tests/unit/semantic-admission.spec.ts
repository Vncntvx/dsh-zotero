/**
 * The admission rule and the baked tier table: an absolute floor refuses a
 * wholly unrelated corpus, the relative margin keeps a same-topic set together,
 * ties stay deterministic, and a bad or missing profile fails closed.
 * @module tests/unit/semantic-admission
 */

import { describe, expect, it } from 'vitest'
import {
  admittedIndexes,
  validateAdmissionRules,
  type AdmissionRules,
} from '../../src/enrichment/semantic/admission.ts'
import {
  ADMISSION_PROFILES,
  admissionProfileOf,
} from '../../src/enrichment/semantic/model-profiles.ts'
import { SEMANTIC_MODEL_KEYS } from '../../src/enrichment-model-catalog.ts'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE } from '../../src/errors.ts'

const rules = (overrides: Partial<AdmissionRules> = {}): AdmissionRules => ({
  floor: 0.5,
  margin: 0.06,
  ...overrides,
})

const unavailable = { code: ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE }

describe('admittedIndexes', () => {
  it('returns nothing when the whole corpus is below the floor', () => {
    // A corpus with nothing relevant: the best neighbour must not be admitted
    // just because it is the best of a bad set.
    expect(admittedIndexes([0.31, 0.44, 0.2], rules({ floor: 0.5 }))).toEqual([])
  })

  it('keeps passages within the margin of the corpus best, best first', () => {
    expect(admittedIndexes([0.71, 0.86, 0.8, 0.3], rules())).toEqual([1, 2])
  })

  it('admits the single best passage when nothing else is close', () => {
    expect(admittedIndexes([0.55, 0.9, 0.51], rules())).toEqual([1])
  })

  it('applies the floor even when the margin would reach lower passages', () => {
    // Best 0.62 - 0.3 margin would reach 0.32, but the floor stays at 0.5.
    expect(admittedIndexes([0.62, 0.48, 0.52], rules({ floor: 0.5, margin: 0.3 }))).toEqual([0, 2])
  })

  it('breaks ties by caller order', () => {
    expect(admittedIndexes([0.8, 0.8], rules())).toEqual([0, 1])
  })

  it('ignores non-finite cosines instead of admitting them', () => {
    // NaN and Infinity are runtime defects; only the finite 0.9 is a hit.
    expect(admittedIndexes([Number.NaN, 0.9, Number.POSITIVE_INFINITY], rules())).toEqual([1])
    expect(admittedIndexes([Number.NaN, 0.2], rules())).toEqual([])
  })

  it('returns nothing for an empty corpus', () => {
    expect(admittedIndexes([], rules())).toEqual([])
  })
})

describe('validateAdmissionRules', () => {
  it('accepts a finite in-range pair', () => {
    expect(validateAdmissionRules(rules(), 'test profile')).toEqual(rules())
  })

  it.each([
    ['negative floor', { floor: -0.1, margin: 0.06 }],
    ['floor above one', { floor: 1.2, margin: 0.06 }],
    ['NaN floor', { floor: Number.NaN, margin: 0.06 }],
    ['negative margin', { floor: 0.5, margin: -0.01 }],
    ['infinite margin', { floor: 0.5, margin: Number.POSITIVE_INFINITY }],
  ])('rejects a %s with the fail-closed code', (_label, candidate) => {
    expect(() => validateAdmissionRules(candidate, 'test profile')).toThrow(
      expect.objectContaining(unavailable),
    )
  })
})

describe('ADMISSION_PROFILES', () => {
  it('covers every catalog tier with a valid profile', () => {
    expect(Object.keys(ADMISSION_PROFILES).sort()).toEqual([...SEMANTIC_MODEL_KEYS].sort())
    for (const key of SEMANTIC_MODEL_KEYS) {
      expect(() => admissionProfileOf(key)).not.toThrow()
      const profile = admissionProfileOf(key)
      expect(profile.floor).toBeGreaterThan(0)
      expect(profile.floor).toBeLessThan(1)
      expect(profile.margin).toBeGreaterThan(0)
      expect(profile.margin).toBeLessThan(0.2)
    }
  })

  it('fails closed for a tier outside the catalog', () => {
    expect(() => admissionProfileOf('not-a-tier' as never)).toThrow(
      expect.objectContaining(unavailable),
    )
  })
})
