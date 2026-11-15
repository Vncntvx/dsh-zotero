/**
 * The vendored semantic runtime, kept honest between the script that copies it,
 * the loader that names it, and the tarball gate: the pin is exact and shared,
 * the packaged files match their provenance hashes, and the license ships
 * beside them. `verify:pack` re-checks the same facts before publishing.
 * @module tests/unit/vendor-onnxruntime
 */

import { describe, expect, it } from 'vitest'
import {
  SEMANTIC_RUNTIME_FILES,
  SEMANTIC_RUNTIME_VERSION,
} from '../../../src/enrichment/semantic/runtime.ts'
import {
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
