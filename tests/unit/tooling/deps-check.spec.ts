/** A range update and a new stable major are separate upgrade signals. */
import { expect, it } from 'vitest'
import { registryVersionsOf } from '../../../scripts/deps-check.mjs'

it('reports a stable release outside the declared range alongside the wanted version', () => {
  expect(
    registryVersionsOf(
      { versions: { '2.0.0': {}, '2.1.0': {}, '3.0.0': {} }, 'dist-tags': { latest: '3.0.0' } },
      '^2.0.0',
    ),
  ).toEqual({ wanted: '2.1.0', latest: '3.0.0', eligible: '3.0.0', outsideRange: true })
})

it('finds updates on the runtime major without selecting the newer major', () => {
  const versions = { '24.19.2': {}, '24.19.3': {}, '26.6.6': {} }
  const tags = { latest: '26.6.6' }
  expect(registryVersionsOf({ versions, 'dist-tags': tags }, '^24.19.2', '24.x')).toMatchObject({
    latest: '26.6.6',
    eligible: '24.19.3',
  })
  delete (versions as Partial<typeof versions>)['24.19.3']
  expect(registryVersionsOf({ versions, 'dist-tags': tags }, '^24.19.2', '24.x').eligible).toBe(
    '24.19.2',
  )
})

it('reports newer releases while selecting the exact host dependency', () => {
  const packument = {
    versions: { '8.11.2': {}, '8.12.4': {} },
    'dist-tags': { latest: '8.12.4' },
  }
  expect(registryVersionsOf(packument, '8.11.2', '8.11.2')).toMatchObject({
    latest: '8.12.4',
    eligible: '8.11.2',
  })
  expect(() => registryVersionsOf(packument, '8.11.2', '9.0.0')).toThrow('constraint')
})

it('refuses incomplete registry metadata rather than reporting dependencies as current', () => {
  expect(() => registryVersionsOf({ versions: { '2.0.0': {} } }, '^2.0.0')).toThrow('latest tag')
  expect(() =>
    registryVersionsOf({ versions: { '2.0.0': {} }, 'dist-tags': { latest: '3.0.0' } }, '^2.0.0'),
  ).toThrow('latest tag')
})
