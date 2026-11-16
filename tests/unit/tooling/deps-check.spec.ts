/** A range update and a new stable major are separate upgrade signals. */
import { expect, it } from 'vitest'
import { registryVersionsOf } from '../../../scripts/deps-check.mjs'

it('reports a stable release outside the declared range alongside the wanted version', () => {
  expect(
    registryVersionsOf(
      { versions: { '2.0.0': {}, '2.1.0': {}, '3.0.0': {} }, 'dist-tags': { latest: '3.0.0' } },
      '^2.0.0',
    ),
  ).toEqual({ wanted: '2.1.0', latest: '3.0.0', outsideRange: true })
})

it('refuses incomplete registry metadata rather than reporting dependencies as current', () => {
  expect(() => registryVersionsOf({ versions: { '2.0.0': {} } }, '^2.0.0')).toThrow('latest tag')
  expect(() =>
    registryVersionsOf({ versions: { '2.0.0': {} }, 'dist-tags': { latest: '3.0.0' } }, '^2.0.0'),
  ).toThrow('latest tag')
})
