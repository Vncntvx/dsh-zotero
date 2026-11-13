/**
 * The bounded cause-chain walk: cycles stop, deep chains stop at their depth
 * budget, and a wide AggregateError still reaches a matching member.
 * @module tests/unit/cause-chain
 */

import { describe, expect, it } from 'vitest'
import { findInCauseChain } from '../../src/cause-chain.js'
import { PublicAddressError } from '../../src/transport/public-url.js'

const isRefusal = (current: object): PublicAddressError | undefined =>
  current instanceof PublicAddressError ? current : undefined

describe('findInCauseChain', () => {
  it('finds the error when it is the whole chain', () => {
    const refusal = new PublicAddressError('refused', 'policy')
    expect(findInCauseChain(refusal, isRefusal)).toBe(refusal)
  })

  it('finds a refusal wrapped in undici-style causes', () => {
    const refusal = new PublicAddressError('refused', 'non-public-address')
    const wrapped = new TypeError('fetch failed', {
      cause: new Error('connect', { cause: refusal }),
    })
    expect(findInCauseChain(wrapped, isRefusal)).toBe(refusal)
  })

  it('stops at a cyclic cause instead of walking forever', () => {
    const outer = new Error('outer')
    const inner = new Error('inner', { cause: outer })
    outer.cause = inner
    expect(findInCauseChain(outer, isRefusal)).toBeUndefined()
  })

  it('stops at the cause-depth budget', () => {
    const refusal = new PublicAddressError('refused', 'policy')
    let chain: Error = refusal
    for (let i = 0; i < 12; i += 1) chain = new Error(`hop ${i}`, { cause: chain })
    expect(findInCauseChain(chain, isRefusal)).toBeUndefined()
  })

  it('still reaches a matching member of a wide AggregateError', () => {
    const refusal = new PublicAddressError('refused', 'non-public-address')
    const members = Array.from({ length: 20 }, () => new Error('plain'))
    members.push(new Error('wrapper', { cause: refusal }))
    expect(findInCauseChain(new AggregateError(members, 'many'), isRefusal)).toBe(refusal)
  })
})
