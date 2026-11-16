/** Configured list caps cannot exceed the Local API's 50-object ceiling. */
import { expect, it } from 'vitest'
import { resolveConfig } from '../../src/config.ts'

it.each([1, 50])('accepts the valid write list boundary %s', (writeListMaxItems) => {
  expect(resolveConfig({ writeListMaxItems }).writeListMaxItems).toBe(writeListMaxItems)
})

it.each([51, 100, Number.MAX_SAFE_INTEGER])(
  'rejects an impossible write list cap %s',
  (writeListMaxItems) => {
    expect(() => resolveConfig({ writeListMaxItems })).toThrow(/writeListMaxItems.*50/)
  },
)
