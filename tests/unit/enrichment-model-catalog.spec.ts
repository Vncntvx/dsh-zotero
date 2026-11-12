/**
 * The selectable local models and the build-time fetcher that installs them.
 *
 * Two failure modes matter here and neither is visible in a diff: the runtime
 * catalog and the script's mirror drifting apart (a user selects a model the
 * fetcher pins differently), and a bundle that ships fewer bytes than its
 * manifest claims. The first is a deep-equality check, the second an on-disk
 * verification of the model the package actually carries.
 * @module tests/unit/enrichment-model-catalog
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allSemanticModels,
  DEFAULT_SEMANTIC_DOWNLOAD_SOURCE,
  DEFAULT_SEMANTIC_MODEL,
  DEFAULT_SEMANTIC_MODEL_ROOT,
  isSemanticDownloadSource,
  isSemanticModelKey,
  SEMANTIC_DOWNLOAD_SOURCES,
  SEMANTIC_MODELS,
  SEMANTIC_MODEL_KEYS,
  semanticModelBytes,
  semanticModelOf,
} from '../../src/enrichment-model-catalog.js'
import { optionsOf } from '../../scripts/fetch-semantic-model.mjs'

// The default install root honors `DSH_HOME`, so an opt-in local bundle is
// inspected wherever the runtime would actually look for it.
const modelDir = (key: string) => join(dshHomePath('models'), key)

describe('semantic model catalog', () => {
  it('leaves the installer nothing of its own to pin', () => {
    // The fetcher used to keep a 375-line mirror of this module, kept in step
    // by a deep-equality case. Node 24 strips types, so the script imports
    // this module directly and the second definition is gone; these are the
    // facts the installer reads.
    expect(DEFAULT_SEMANTIC_MODEL_ROOT).toBe('~/.dsh/models')
    expect(SEMANTIC_MODELS).toHaveLength(SEMANTIC_MODEL_KEYS.length)
    for (const model of SEMANTIC_MODELS) {
      expect(model.files.length).toBeGreaterThan(0)
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('defines download sources including hf-mirror and huggingface', () => {
    expect(SEMANTIC_DOWNLOAD_SOURCES).toEqual(['hf-mirror', 'huggingface'])
    expect(DEFAULT_SEMANTIC_DOWNLOAD_SOURCE).toBe('hf-mirror')
  })

  it('offers distinct keys across the size tiers', () => {
    expect(SEMANTIC_MODEL_KEYS).toHaveLength(6)
    expect(new Set(SEMANTIC_MODEL_KEYS).size).toBe(6)
    expect(SEMANTIC_MODEL_KEYS).toEqual([
      'balanced',
      'lightweight',
      'bilingual',
      'english',
      'hybrid',
      'academic',
    ])
    expect(SEMANTIC_MODEL_KEYS).toContain(DEFAULT_SEMANTIC_MODEL)
  })

  it('pins every file the loader needs with a full digest and a real size', () => {
    const required = [
      'config.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'tokenizer.json',
      'onnx/model_quantized.onnx',
    ]
    for (const model of SEMANTIC_MODELS) {
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(model.files.map((file) => file.path)).toEqual(required)
      for (const file of model.files) {
        expect(file.sha256, `${model.key}/${file.path}`).toMatch(/^[0-9a-f]{64}$/)
        expect(file.bytes).toBeGreaterThan(0)
      }
      expect(semanticModelBytes(model)).toBe(model.files.reduce((sum, file) => sum + file.bytes, 0))
    }
  })

  it('orders the tiers by bundle size', () => {
    const sizes = Object.fromEntries(
      SEMANTIC_MODELS.map((model) => [model.key, semanticModelBytes(model)]),
    )
    expect(sizes['lightweight']!).toBeLessThan(sizes['english']!)
    expect(sizes['english']!).toBeLessThan(sizes['academic']!)
    expect(sizes['academic']!).toBeLessThan(sizes['bilingual']!)
    expect(sizes['bilingual']!).toBeLessThan(sizes['hybrid']!)
    expect(sizes['hybrid']!).toBeLessThan(sizes['balanced']!)
    expect(sizes['lightweight']!).toBeLessThan(150_000_000)
    expect(sizes['balanced']!).toBeGreaterThan(600_000_000)
  })

  it('names the valid keys when asked for an unknown model', () => {
    expect(() => semanticModelOf('nope')).toThrow(/unknown semantic model "nope"/)
    expect(() => semanticModelOf('nope')).toThrow(/balanced/)
    expect(semanticModelOf('balanced').dimension).toBe(1024)
    expect(semanticModelOf('balanced').physicalKey).toBe('qwen3-0.6b')
  })

  it('identifies valid and invalid model keys and download sources', () => {
    expect(isSemanticModelKey('balanced')).toBe(true)
    expect(isSemanticModelKey('lightweight')).toBe(true)
    expect(isSemanticModelKey('qwen3-0.6b')).toBe(false)
    expect(isSemanticModelKey('unknown-model')).toBe(false)
    expect(isSemanticModelKey(null)).toBe(false)

    expect(isSemanticDownloadSource('hf-mirror')).toBe(true)
    expect(isSemanticDownloadSource('huggingface')).toBe(true)
    expect(isSemanticDownloadSource('modelscope')).toBe(false)
    expect(isSemanticDownloadSource(123)).toBe(false)

    expect(allSemanticModels()).toEqual(SEMANTIC_MODELS)
  })

  it('verifies the model bundle structure against its manifest when present on disk', () => {
    const model = semanticModelOf(DEFAULT_SEMANTIC_MODEL)
    const manifestPath = join(modelDir(model.physicalKey), 'manifest.json')
    if (existsSync(manifestPath)) {
      for (const file of model.files) {
        expect(statSync(join(modelDir(model.physicalKey), file.path)).size, file.path).toBe(
          file.bytes,
        )
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      expect(manifest.key).toBe(model.key)
      expect(manifest.revision).toBe(model.revision)
      expect(manifest.dimension).toBe(model.dimension)
      for (const file of model.files) expect(manifest.files[file.path].sha256).toBe(file.sha256)
    }
  })
})

describe('fetch-semantic-model options', () => {
  it('defaults to the shipped model and the mirror-first order', () => {
    const options = optionsOf([])
    expect(options.keys).toEqual([DEFAULT_SEMANTIC_MODEL])
    expect(options.order).toEqual(['hf-mirror', 'huggingface'])
    expect(options.proxy).toBeUndefined()
    expect(options.noProxy).toBe(false)
    expect(options.verifyOnly).toBe(false)
  })

  it('selects one model, or every catalog model', () => {
    expect(optionsOf(['--model=bilingual']).keys).toEqual(['bilingual'])
    expect(optionsOf(['--model=all']).keys).toEqual([...SEMANTIC_MODEL_KEYS])
    expect(() => optionsOf(['--model=nope'])).toThrow(/unknown semantic model/)
  })

  it('pins one source, a proxy, a direct connection, or a timeout', () => {
    expect(optionsOf(['--source=huggingface']).order).toEqual(['huggingface'])
    expect(optionsOf(['--proxy=http://127.0.0.1:7890']).proxy).toBe('http://127.0.0.1:7890')
    expect(optionsOf(['--no-proxy']).noProxy).toBe(true)
    expect(optionsOf(['--timeout-ms=1000']).timeoutMs).toBe(1000)
    expect(optionsOf(['--dir=/tmp/models']).dir).toBe('/tmp/models')
    expect(() => optionsOf(['--source=nope'])).toThrow(/unknown --source=nope/)
    expect(() => optionsOf(['--timeout-ms=0'])).toThrow(/invalid --timeout-ms/)
  })
})
