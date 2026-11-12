/**
 * The catalog manifest rule install, readiness and load share.
 *
 * The rule lives in one module because three copies had already drifted: the
 * installer refused a record with no pinned files and the inspector accepted
 * one. These cases drive the shared function directly, so a future edit cannot
 * reintroduce a per-caller interpretation.
 * @module tests/unit/model-manifest
 */

import { describe, expect, it } from 'vitest'
import type { SemanticModelManifest } from '../../src/enrichment-model-catalog.ts'
import { catalogFilePinsOf, safeRelativePath } from '../../src/enrichment/model-manifest.ts'

function record(overrides: Record<string, unknown> = {}): SemanticModelManifest {
  return {
    schema: 2,
    key: 'balanced',
    physicalKey: 'qwen3-0.6b',
    modelId: 'acme/model',
    revision: 'a'.repeat(40),
    dimension: 2,
    maxTokens: 16,
    pooling: 'mean',
    normalize: true,
    queryPrefix: '',
    documentPrefix: '',
    files: { 'config.json': { bytes: 5, sha256: 'b'.repeat(64) } },
    ...overrides,
  } as unknown as SemanticModelManifest
}

function refusalOf(value: unknown): string {
  try {
    catalogFilePinsOf(value as SemanticModelManifest, (reason) => {
      throw new Error(reason)
    })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ''
}

describe('catalogFilePinsOf', () => {
  it('accepts a well-formed record', () => {
    const pins = catalogFilePinsOf(record(), (reason) => {
      throw new Error(reason)
    })
    expect([...pins.keys()]).toEqual(['config.json'])
    expect(pins.get('config.json')).toEqual({
      path: 'config.json',
      bytes: 5,
      sha256: 'b'.repeat(64),
    })
  })

  it('refuses a record that pins nothing', () => {
    // The inspector used to accept this while the installer refused it, so a
    // bundle with no files could be called ready by one path and uninstallable
    // by another.
    expect(refusalOf(record({ files: {} }))).toMatch(/no pinned files/)
    expect(refusalOf(record({ files: null }))).toMatch(/no file record/)
  })

  it('refuses a record that is not schema 2', () => {
    expect(refusalOf(record({ schema: 1 }))).toMatch(/not version 2/)
  })

  it('refuses an unsafe physical key', () => {
    expect(refusalOf(record({ physicalKey: '../escape' }))).toMatch(/not a single safe directory/)
  })

  it('refuses traversal, reserved names and duplicates', () => {
    for (const path of ['../x', 'a//b', './x', 'c:/x', '']) {
      expect(
        refusalOf(record({ files: { [path]: { bytes: 1, sha256: 'c'.repeat(64) } } })),
      ).toMatch(/invalid catalog path/)
    }
    expect(
      refusalOf(record({ files: { 'manifest.json': { bytes: 1, sha256: 'c'.repeat(64) } } })),
    ).toMatch(/reserved catalog path/)
  })

  it('refuses a bad byte or digest pin', () => {
    expect(
      refusalOf(record({ files: { 'a.bin': { bytes: -1, sha256: 'c'.repeat(64) } } })),
    ).toMatch(/invalid pin/)
    expect(refusalOf(record({ files: { 'a.bin': { bytes: 1, sha256: 'XYZ' } } }))).toMatch(
      /invalid pin/,
    )
  })
})

describe('safeRelativePath', () => {
  it('returns the path when every segment is safe', () => {
    expect(
      safeRelativePath('onnx/model_quantized.onnx', (reason) => {
        throw new Error(reason)
      }),
    ).toBe('onnx/model_quantized.onnx')
  })
})
