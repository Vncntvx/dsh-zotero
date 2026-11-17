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

it('locks the reviewed ratchet ceilings and grandfathered paths', () => {
  expect({ MAX_SPEC_LINES, MAX_HELPER_LINES, HELPER_SIZE_BASELINE }).toEqual({
    MAX_SPEC_LINES: 726,
    MAX_HELPER_LINES: 300,
    HELPER_SIZE_BASELINE: {
      'tests/client/helpers/source-fixtures.ts': 128,
      'tests/client/helpers/apply-world.ts': 350,
      'tests/client/helpers/library-panel-harness.tsx': 156,
      'tests/host/support/enrichment-parse-endpoints.ts': 334,
      'tests/host/support/enrichment-parse-jobs.ts': 323,
    },
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
