import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_SPEC_LINES,
  MAX_HELPER_LINES,
  HELPER_SIZE_BASELINE,
  specFiles,
  textFiles,
  unscannedExtensionsOf,
  wholesalePrimitiveMocksOf,
  focusViolationsOf,
  fetchOwnershipIssuesOf,
} from '../../../scripts/test-lint.mjs'
import { coverageThresholds } from '../../../vitest.config.ts'

it('locks the reviewed ratchet ceilings and grandfathered paths', () => {
  expect({ MAX_SPEC_LINES, MAX_HELPER_LINES, HELPER_SIZE_BASELINE }).toEqual({
    MAX_SPEC_LINES: 726,
    MAX_HELPER_LINES: 300,
    HELPER_SIZE_BASELINE: {
      'tests/client/helpers/source-fixtures.ts': 128,
      'tests/client/helpers/apply-world.ts': 350,
      'tests/client/helpers/library-panel-harness.tsx': 150,
      'tests/host/support/enrichment-parse-endpoints.ts': 332,
      'tests/host/support/enrichment-parse-jobs.ts': 323,
    },
  })
})

it('locks the coverage floors the gate enforces', () => {
  // Same discipline as the size ratchet above: lowering a floor must touch
  // this spec in the same commit, with the before/after evidence the config
  // comments carry. Re-siting a floor updates both places at once.
  expect(coverageThresholds).toEqual({
    'src/*.ts': { statements: 98, branches: 95.8, functions: 98, lines: 98 },
    'src/transport/**': { statements: 98.57, branches: 98.13, functions: 99.9, lines: 99.9 },
    'src/library/**': { statements: 96.88, branches: 91.08, functions: 99.9, lines: 98.48 },
    'src/skills/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
    'src/session-projection/**': {
      statements: 100,
      branches: 91.57,
      functions: 100,
      lines: 100,
    },
    'src/local/**': { statements: 97.7, branches: 93, functions: 99, lines: 97.8 },
    'src/tools/**': { statements: 98, branches: 95, functions: 99, lines: 99 },
    'src/sources/**': { statements: 96, branches: 94, functions: 97, lines: 97 },
    'src/client/components/**': { statements: 95, branches: 92.8, functions: 98.6, lines: 97 },
    'src/client/reader/**': { statements: 93.6, branches: 88.7, functions: 94.4, lines: 97 },
    'src/client/**': { statements: 95.6, branches: 91.9, functions: 95.9, lines: 97 },
    'src/scholarly/**': { statements: 95, branches: 88, functions: 91, lines: 95 },
    'src/enrichment/**': { statements: 89.3, branches: 85.7, functions: 90.1, lines: 90.9 },
    'src/enrichment/semantic/**': { statements: 79, branches: 78, functions: 65, lines: 79 },
    'src/enrichment/model-downloader.ts': {
      statements: 87,
      branches: 74,
      functions: 84,
      lines: 86.5,
    },
    'src/enrichment/model-download-client.ts': {
      statements: 87.2,
      branches: 75.6,
      functions: 59,
      lines: 89.4,
    },
    statements: 96.2,
    branches: 92.6,
    functions: 96.8,
    lines: 96.9,
  })
})

it('inventories TS module variants, workflow files and extensionless text', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lint-inventory-'))
  try {
    for (const path of [
      'tests/unit/a.spec.mts',
      'tests/unit/b.spec.cts',
      '.github/workflows/check.yml',
      'scripts/NOTICE',
      'LICENSE',
      'README.md',
    ]) {
      mkdirSync(join(root, path, '..'), { recursive: true })
      writeFileSync(join(root, path), '')
    }
    expect(specFiles(root)).toEqual(['tests/unit/a.spec.mts', 'tests/unit/b.spec.cts'])
    expect(textFiles(root).map((path) => relative(root, path))).toEqual(
      expect.arrayContaining([
        '.github/workflows/check.yml',
        'scripts/NOTICE',
        'LICENSE',
        'README.md',
      ]),
    )
    expect(unscannedExtensionsOf(['.github/NOTICE', 'scripts/LICENSE'])).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const moduleName = '@deepseek-ai/dsh-client-ui-primitives'
describe('primitive mocks retain the actual namespace', () => {
  it.each([
    `vi.mock('${moduleName}', async (unused) => ({}))`,
    `const target = '${moduleName}'; vi.mock(target, () => ({}))`,
    `import { vi as testing } from 'vitest'; const prefix = '@deepseek-ai/'; const target = prefix + 'dsh-client-ui-primitives'; testing.doMock(target, () => ({}))`,
    `vi.mock('${moduleName}', async (original) => { const actual = await original(); return { Button: actual.Button } })`,
    `vi.mock('${moduleName}', async (original) => { const actual = await original(); if (flag) return {}; return { ...actual } })`,
  ])('rejects a namespace replacement: %s', (source) => {
    expect(wholesalePrimitiveMocksOf(source)).toHaveLength(1)
  })
  it('accepts a real namespace spread with one overridden export', () => {
    expect(
      wholesalePrimitiveMocksOf(
        `vi.mock('${moduleName}', async (original) => { const actual = await original(); return { ...actual, Button: replacement } })`,
      ),
    ).toEqual([])
  })
})

it('checks executable template expressions while ignoring regex and template text', () => {
  expect(focusViolationsOf('const text = `it.only("example")`; const regex = /it.only/g')).toEqual(
    [],
  )
  expect(focusViolationsOf('const text = `value: ${it.only("actual", () => {})}`')).toHaveLength(1)
})

it.each([
  'const get = fetch',
  'const get = window.fetch',
  'const get = globalThis["fetch"]',
  'const { fetch: get } = window',
])('rejects runtime fetch aliases: %s', (source) => {
  expect(fetchOwnershipIssuesOf('src/scholarly/reader.ts', source)).not.toEqual([])
})
