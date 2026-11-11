/**
 * Tests for model-dir resolution.
 * @module tests/unit/enrichment-model-dir
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { describe, expect, it } from 'vitest'
import {
  resolveSemanticModelDir,
  resolveSemanticModelRoot,
} from '../../src/enrichment/model-dir.js'

describe('resolveSemanticModelRoot', () => {
  it('defaults to ~/.dsh/models when omitted or empty', () => {
    expect(resolveSemanticModelRoot()).toBe(dshHomePath('models'))
    expect(resolveSemanticModelRoot('')).toBe(dshHomePath('models'))
    expect(resolveSemanticModelRoot('   ')).toBe(dshHomePath('models'))
    expect(resolveSemanticModelRoot()).toBe(join(homedir(), '.dsh', 'models'))
  })

  it('expands ~ for custom directories', () => {
    expect(resolveSemanticModelRoot('~/my-models')).toBe(join(homedir(), 'my-models'))
  })

  it('preserves absolute paths', () => {
    expect(resolveSemanticModelRoot('/opt/models')).toBe('/opt/models')
  })
})

describe('resolveSemanticModelDir', () => {
  it('maps semantic tier keys to their underlying physical model directory', () => {
    expect(resolveSemanticModelDir('balanced')).toBe(join(dshHomePath('models'), 'qwen3-0.6b'))
    expect(resolveSemanticModelDir('bilingual', '/opt/models')).toBe('/opt/models/kalm-0.5b')
    expect(resolveSemanticModelDir('lightweight')).toBe(join(dshHomePath('models'), 'granite-97m'))
    expect(resolveSemanticModelDir('custom-model')).toBe(
      join(dshHomePath('models'), 'custom-model'),
    )
  })
})
