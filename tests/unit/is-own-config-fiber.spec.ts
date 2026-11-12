/**
 * Unit tests for the `internal/config` fiber guard in `src/service.ts`. The
 * waterfall hands over the resolving fiber itself, so identity is the whole
 * contract: a prototype-linked face is a different object and belongs to
 * another plugin's resolution.
 * @module tests/unit/is-own-config-fiber
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { isOwnConfigFiber } from '../../src/service.js'

/** One real fiber: the Context itself is the root plugin's fiber. */
const ctx = new Context()
const own = ctx.fiber

describe('isOwnConfigFiber', () => {
  it('accepts the fiber itself', () => {
    expect(isOwnConfigFiber(own, own)).toBe(true)
  })

  it('rejects a prototype-linked face of the same fiber', () => {
    // `ctx.plugin()` hands such a face to plugin bodies; the waterfall never
    // carries one, and treating it as this fiber would let a child's config
    // resolution re-validate the parent's entry.
    expect(isOwnConfigFiber(Object.create(own), own)).toBe(false)
  })

  it('rejects a foreign fiber', () => {
    const foreign = new Context().fiber
    expect(isOwnConfigFiber(foreign, own)).toBe(false)
  })

  it('rejects non-fiber values', () => {
    expect(isOwnConfigFiber(null, own)).toBe(false)
    expect(isOwnConfigFiber(undefined, own)).toBe(false)
    expect(isOwnConfigFiber(42, own)).toBe(false)
  })
})
