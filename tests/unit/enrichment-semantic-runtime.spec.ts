/**
 * The packaged semantic runtime: the loader points the WASM backend at the
 * tarball's own assets, and a tarball that lost them fails closed naming the
 * missing files instead of surfacing a bare resolution failure. The vendoring
 * script and this loader agree on the file list and the pinned version; the
 * release gate proves those files reach the tarball.
 * @module tests/unit/enrichment-semantic-runtime
 */

import { writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE, ZoteroError } from '../../src/errors.ts'
import {
  loadSemanticRuntime,
  SEMANTIC_RUNTIME_FILES,
  SEMANTIC_RUNTIME_VERSION,
  semanticRuntimeDir,
  type SemanticRuntime,
} from '../../src/enrichment/semantic/runtime.ts'
import { withTempDir } from '../helpers/temp-dir.ts'

/** The importer is an external seam: this spec supplies only the env it consumes. */
function fakeRuntime(): SemanticRuntime {
  const fixture = {
    env: { versions: { common: 'fixture' }, wasm: {}, webgl: {}, webgpu: {} },
  }
  return fixture as SemanticRuntime
}

async function runtimeFiles(dir: string): Promise<void> {
  for (const file of SEMANTIC_RUNTIME_FILES) await writeFile(join(dir, file), '', 'utf8')
}

describe('loadSemanticRuntime', () => {
  it('imports the vendored entry from the supplied directory', async () => {
    await withTempDir(async (dir) => {
      await runtimeFiles(dir)
      const load = vi.fn(async () => fakeRuntime())
      await loadSemanticRuntime(dir, load)
      expect(load).toHaveBeenCalledWith(pathToFileURL(join(dir, 'ort.node.min.mjs')).href)
    })
  })

  it('points the wasm loader at the supplied assets with a trailing separator', async () => {
    await withTempDir(async (dir) => {
      await runtimeFiles(dir)
      const runtime = await loadSemanticRuntime(dir, async () => fakeRuntime())
      expect(runtime.env.wasm.wasmPaths).toBe(`${dir}${sep}`)
      expect(runtime.env.wasm.numThreads).toBe(1)
      expect(runtime.env.wasm.simd).toBe(true)
      expect(runtime.env.logLevel).toBe('error')
    })
  })

  it('keeps one separator when the directory already ends with one', async () => {
    await withTempDir(async (dir) => {
      await runtimeFiles(dir)
      const withSeparator = `${dir}${sep}`
      const runtime = await loadSemanticRuntime(withSeparator, async () => fakeRuntime())
      expect(runtime.env.wasm.wasmPaths).toBe(withSeparator)
    })
  })

  it('fails closed naming every file a broken package lost', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'ort.node.min.mjs'), '', 'utf8')
      const load = vi.fn(async () => fakeRuntime())
      const error = await loadSemanticRuntime(dir, load).catch((thrown: unknown) => thrown)
      expect(error).toBeInstanceOf(ZoteroError)
      expect((error as ZoteroError).code).toBe(ZOTERO_ENRICHMENT_SEMANTIC_UNAVAILABLE)
      expect((error as ZoteroError).message).toContain('ort-wasm-simd-threaded.mjs')
      expect((error as ZoteroError).message).toContain('ort-wasm-simd-threaded.wasm')
      expect(load).not.toHaveBeenCalled()
    })
  })
})

describe('the packaged runtime identity', () => {
  it('names the versioned asset directory inside the package', () => {
    expect(SEMANTIC_RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    const segments = semanticRuntimeDir()
      .replace(/[\\/]+$/, '')
      .split(sep)
    expect(segments.slice(-3)).toEqual(['assets', 'onnxruntime', SEMANTIC_RUNTIME_VERSION])
  })

  it('requires the entry, the wasm glue, and the wasm binary', () => {
    expect([...SEMANTIC_RUNTIME_FILES]).toEqual([
      'ort.node.min.mjs',
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ])
  })
})
