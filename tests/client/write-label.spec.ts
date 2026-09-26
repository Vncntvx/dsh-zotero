/**
 * Tests for writeStatusLabel helper.
 * @module tests/client/write-label
 */

import { describe, expect, it } from 'vitest'
import { writeStatusLabel } from '../../src/client/components/write-label.ts'
import { zh } from '../../src/client/locales.ts'
import { mockT } from './helpers/mock-translate.ts'

describe('writeStatusLabel', () => {
  it('returns "-" when write is undefined', () => {
    expect(writeStatusLabel(undefined, mockT)).toBe('-')
  })

  it('returns writeDisabledLabel when write is disabled', () => {
    expect(writeStatusLabel({ enabled: false, authorized: false }, mockT)).toBe(
      zh.writeDisabledLabel,
    )
  })

  it('returns writeAuthorizedLabel when write is enabled and authorized', () => {
    expect(writeStatusLabel({ enabled: true, authorized: true }, mockT)).toBe(
      zh.writeAuthorizedLabel,
    )
  })

  it('returns writeUnauthorizedLabel when write is enabled but unauthorized', () => {
    expect(writeStatusLabel({ enabled: true, authorized: false }, mockT)).toBe(
      zh.writeUnauthorizedLabel,
    )
  })
})
