// @vitest-environment node
/**
 * Chinese notices of at most two sentences omit the trailing 句号. This test
 * applies that rule to every Chinese value in the three client dictionaries.
 */
import { describe, expect, it } from 'vitest'
import { zh as clientZh } from '../../src/client/locales.ts'
import { libraryZh } from '../../src/client/library-settings-locales.ts'
import { parseZh } from '../../src/client/enrichment/parse-locales.ts'

const DICTIONARIES = [
  ['client', clientZh],
  ['library-settings', libraryZh],
  ['parse', parseZh],
] as const

function sentenceCount(value: string): number {
  const endings = value.match(/[。！？!?]/g)?.length ?? 0
  return endings === 0 ? 1 : endings
}

describe('Chinese notice punctuation', () => {
  it('omits the trailing 句号 for values of at most two sentences', () => {
    const violations: string[] = []
    for (const [name, dictionary] of DICTIONARIES) {
      for (const [key, value] of Object.entries(dictionary)) {
        if (typeof value !== 'string' || !/[\u4e00-\u9fff]/.test(value)) continue
        if (value.endsWith('。') && sentenceCount(value) <= 2) violations.push(`${name}.${key}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps the current dictionaries free of short trailing 句号', () => {
    const endings = DICTIONARIES.flatMap(([name, dictionary]) =>
      Object.entries(dictionary)
        .filter(([, value]) => typeof value === 'string' && value.endsWith('。'))
        .map(([key]) => `${name}.${key}`),
    )
    expect(endings).toEqual([])
  })
})
