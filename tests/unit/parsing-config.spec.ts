/**
 * The parsing config resolver: unwraps volatile references and refuses
 * malformed values, mirroring the library resolver's contract.
 * @module tests/unit/parsing-config
 */

import { describe, expect, it } from 'vitest'
import { ParsingConfigSchema, resolveParsingConfig } from '../../src/parsing/config.ts'

/** `isVolatile` recognizes a reference by this symbol-keyed `write` member. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

function volatileOf<T>(value: T): { get: () => T } & Record<symbol, unknown> {
  return { get: () => value, [VOLATILE_WRITE]: () => {} }
}

describe('resolveParsingConfig', () => {
  it('returns the defaults for an absent section', () => {
    expect(resolveParsingConfig()).toEqual({
      mode: 'free',
      mineruTokenRef: '',
      allowParsingUpload: false,
      outputDir: '',
    })
  })

  it('unwraps volatile references', () => {
    expect(
      resolveParsingConfig({
        mode: volatileOf('pro') as never,
        mineruTokenRef: volatileOf(' MINERU_API_TOKEN ') as never,
        allowParsingUpload: volatileOf(true) as never,
        outputDir: volatileOf(' /tmp/parsed ') as never,
      }),
    ).toEqual({
      mode: 'pro',
      mineruTokenRef: 'MINERU_API_TOKEN',
      allowParsingUpload: true,
      outputDir: '/tmp/parsed',
    })
  })

  it('refuses an invalid mode through the shared contract', () => {
    expect(() => resolveParsingConfig({ mode: volatileOf('turbo') as never })).toThrow(
      'Invalid parsing preference: mode',
    )
  })

  it('refuses a relative output directory at the schema boundary', () => {
    expect(() => ParsingConfigSchema({ outputDir: 'relative/papers' })).toThrow()
    expect(() => ParsingConfigSchema({ outputDir: '~docs/papers' })).toThrow()
    expect(
      resolveParsingConfig(ParsingConfigSchema({ outputDir: '/tmp/parsed' }) as never).outputDir,
    ).toBe('/tmp/parsed')
    expect(
      resolveParsingConfig(ParsingConfigSchema({ outputDir: '~/parsed' }) as never).outputDir,
    ).toBe('~/parsed')
    expect(resolveParsingConfig(ParsingConfigSchema({ outputDir: '' }) as never).outputDir).toBe('')
  })
})
