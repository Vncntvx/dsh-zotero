/**
 * Unit tests for the `internal/config` fiber guard in `src/service.ts`. The
 * false arms need a foreign `this` no in-lane waterfall can carry, so the
 * pure predicate is exercised here directly.
 * @module tests/unit/is-own-config-fiber
 */

import { describe, expect, it } from 'vitest'
import type { Fiber } from '@deepseek-ai/cordis'
import { isOwnConfigFiber } from '../../src/service.js'

const own = { name: 'ZoteroService' } as unknown as Fiber

describe('isOwnConfigFiber', () => {
  it('accepts the fiber itself', () => {
    expect(isOwnConfigFiber(own, own)).toBe(true)
  })

  it('accepts the prototype-linked face ctx.plugin() hands out', () => {
    const face = Object.create(own)
    expect(isOwnConfigFiber(face, own)).toBe(true)
  })

  it('rejects a foreign fiber', () => {
    const foreign = { name: 'other-plugin' } as unknown as Fiber
    expect(isOwnConfigFiber(foreign, own)).toBe(false)
  })

  it('rejects a face linked to a foreign fiber', () => {
    const foreign = { name: 'other-plugin' } as unknown as Fiber
    expect(isOwnConfigFiber(Object.create(foreign), own)).toBe(false)
  })

  it('rejects a primitive this', () => {
    expect(isOwnConfigFiber(null, own)).toBe(false)
    expect(isOwnConfigFiber(undefined, own)).toBe(false)
    expect(isOwnConfigFiber(42, own)).toBe(false)
  })
})
