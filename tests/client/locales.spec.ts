import { clientLocaleSources, unusedLocaleKeys } from '../../scripts/locale-usage.mjs'
/**
 * Locale bundle discipline: key parity between zh and en, the retired-key
 * absence, non-empty values, no Chinese in the English copy, and none of the
 * stage claims the panel must not make.
 * @module tests/client/locales
 */

import { describe, expect, it } from 'vitest'
import { en, zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'

describe('locale bundles', () => {
  it('carries the same key set in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('uses every locale key through production code or a documented settings transform', () => {
    expect(unusedLocaleKeys(Object.keys(en), clientLocaleSources(process.cwd()))).toEqual([])
  })

  it('keeps every value non-empty and free of Chinese in the English copy', () => {
    for (const key of Object.keys(en) as ZoteroLocaleKey[]) {
      expect(en[key].length, key).toBeGreaterThan(0)
      expect(zh[key].length, key).toBeGreaterThan(0)
      expect(/[\u4e00-\u9fff]/.test(en[key]), key).toBe(false)
    }
  })

  it('never claims stages the calls cannot prove', () => {
    const allZh = Object.values(zh).join(' ')
    expect(allZh).not.toContain('精读')
    expect(allZh).not.toContain('已引用')
    expect(allZh).not.toContain('整理我的库')
    expect(allZh).not.toContain('Personal library')
    expect(allZh).not.toContain('evidence passages')
    expect(allZh).not.toContain('证据')
  })

  it('never points at the removed Settings location', () => {
    for (const value of [...Object.values(zh), ...Object.values(en)]) {
      expect(value).not.toContain('设置 -> Zotero')
      expect(value).not.toContain('Settings → Zotero')
    }
  })
})
