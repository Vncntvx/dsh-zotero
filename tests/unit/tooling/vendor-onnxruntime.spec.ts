/**
 * The vendored semantic runtime, kept honest between the script that copies it,
 * the loader that names it, and the tarball gate: the pin is exact and shared,
 * the packaged files match their provenance hashes, and the license ships
 * beside them. `verify:pack` re-checks the same facts before publishing.
 * @module tests/unit/vendor-onnxruntime
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SEMANTIC_RUNTIME_FILES,
  SEMANTIC_RUNTIME_VERSION,
} from '../../../src/enrichment/semantic/runtime.ts'
import {
  assetsRoot,
  checkVendoredRuntime,
  packedRuntimePaths,
  pinnedVersion,
  runtimeFileNames,
} from '../../../scripts/vendor-onnxruntime.mjs'

describe('the vendored semantic runtime', () => {
  it('pins the assets to the exact version the loader names', () => {
    expect(pinnedVersion()).toBe(SEMANTIC_RUNTIME_VERSION)
  })

  it('copies exactly the files the loader requires', () => {
    expect(runtimeFileNames()).toEqual([...SEMANTIC_RUNTIME_FILES].sort())
  })

  it('matches every packaged file against its provenance and ships the license', () => {
    expect(checkVendoredRuntime()).toBe(SEMANTIC_RUNTIME_VERSION)
  })

  it('names every packaged path the tarball gate must find', () => {
    const versioned = packedRuntimePaths().filter((path) =>
      path.includes(`/${SEMANTIC_RUNTIME_VERSION}/`),
    )
    expect(new Set(versioned)).toEqual(
      new Set([
        ...SEMANTIC_RUNTIME_FILES.map(
          (file) => `assets/onnxruntime/${SEMANTIC_RUNTIME_VERSION}/${file}`,
        ),
        `assets/onnxruntime/${SEMANTIC_RUNTIME_VERSION}/provenance.json`,
      ]),
    )
    expect(packedRuntimePaths()).toContain('assets/onnxruntime/LICENSE')
  })
})

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})
it('refuses a tampered runtime even when the attacker rewrites its generated provenance', () => {
  const copy = mkdtempSync(join(tmpdir(), 'dsh-runtime-release-'))
  temporary.push(copy)
  cpSync(assetsRoot(), copy, { recursive: true })
  const file = join(copy, pinnedVersion(), 'ort.node.min.mjs')
  const bytes = Buffer.concat([readFileSync(file), Buffer.from('\n// forged runtime')])
  writeFileSync(file, bytes)
  const path = join(copy, pinnedVersion(), 'provenance.json')
  const provenance = JSON.parse(readFileSync(path, 'utf8'))
  provenance.files['ort.node.min.mjs'] = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  writeFileSync(path, JSON.stringify(provenance))
  expect(() => checkVendoredRuntime(copy)).toThrow('independently reviewed upstream release')
})

it('verifies license content against the independent upstream identity', () => {
  const copy = mkdtempSync(join(tmpdir(), 'dsh-runtime-license-'))
  temporary.push(copy)
  cpSync(assetsRoot(), copy, { recursive: true })
  writeFileSync(join(copy, 'LICENSE'), 'License file exists but its content is wrong')
  expect(() => checkVendoredRuntime(copy)).toThrow(
    'LICENSE differs from the independently reviewed upstream release',
  )
})
