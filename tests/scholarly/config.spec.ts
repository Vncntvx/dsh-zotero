/**
 * The scholarly background-job policy fields: defaults and live resolution.
 * @module tests/scholarly/config
 */

import { describe, expect, it } from 'vitest'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { resolveScholarlyConfig } from '../../src/scholarly/config.js'

describe('scholarly job policy config', () => {
  it('defaults background execution on with a 30s foreground wait', () => {
    const resolved = resolveScholarlyConfig({})
    expect(resolved.enableRunInBackground).toBe(true)
    expect(resolved.promoteOnTimeout).toBe(true)
    expect(resolved.foregroundWaitMs).toBe(30_000)
  })

  it('resolves explicit values without re-validating the schema bounds', () => {
    const resolved = resolveScholarlyConfig({
      enableRunInBackground: createVolatile(false),
      promoteOnTimeout: createVolatile(false),
      foregroundWaitMs: createVolatile(5_000),
    })
    expect(resolved.enableRunInBackground).toBe(false)
    expect(resolved.promoteOnTimeout).toBe(false)
    expect(resolved.foregroundWaitMs).toBe(5_000)
  })
})
