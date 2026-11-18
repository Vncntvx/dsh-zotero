import { expect, it } from 'vitest'
import { specSizeViolations } from '../../../scripts/test-lint.mjs'

const spec = 'tests/unit/example.spec.ts'

it('allows a standard spec up to 400 lines', () => {
  expect(specSizeViolations([{ path: spec, lines: 400 }], {})).toEqual([])
  expect(specSizeViolations([{ path: spec, lines: 401 }], {})).toEqual([
    { kind: 'new', path: spec, lines: 401, limit: 400 },
  ])
})

it('freezes grandfathered specs and requires shrinking their baseline with them', () => {
  const baseline = { [spec]: 470 }
  expect(specSizeViolations([{ path: spec, lines: 470 }], baseline)).toEqual([])
  expect(specSizeViolations([{ path: spec, lines: 471 }], baseline)).toEqual([
    { kind: 'grown', path: spec, lines: 471, limit: 470 },
  ])
  expect(specSizeViolations([{ path: spec, lines: 460 }], baseline)).toEqual([
    { kind: 'shrunk', path: spec, lines: 460, limit: 470 },
  ])
  expect(specSizeViolations([], baseline)).toEqual([
    { kind: 'stale', path: spec, lines: 0, limit: 470 },
  ])
})
