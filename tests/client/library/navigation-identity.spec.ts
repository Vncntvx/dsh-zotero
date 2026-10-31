/**
 * The panel's identity rules: what counts as the same object across instance
 * qualifiers and libraries, and what one reading scope answers to.
 * @module tests/client/library/navigation-identity
 */

import { describe, expect, it } from 'vitest'
import {
  objectIdentity,
  scopeKeyOf,
} from '../../../src/client/components/library/navigation-identity.ts'

const personal = { type: 'user', id: 0 } as const
const bare = 'zotero://user/0/collection/COLL0001'
const qualified = `${bare}?server=S1`

describe('object identity', () => {
  it('treats an unqualified ref and its qualified spelling as one object', () => {
    expect(objectIdentity(bare, 'S1')).toBe(objectIdentity(qualified, 'S1'))
  })

  it('keeps the same ref apart under another instance', () => {
    expect(objectIdentity(bare, 'S2')).not.toBe(objectIdentity(qualified, 'S1'))
  })

  it('keeps the same key in another library apart', () => {
    expect(objectIdentity('zotero://group/123/collection/COLL0001', 'S1')).not.toBe(
      objectIdentity(qualified, 'S1'),
    )
  })

  it('uses a non-ref string as its own identity', () => {
    expect(objectIdentity('not-a-url', 'S1')).toBe('not-a-url')
  })
})

describe('scope key', () => {
  it('separates instances, libraries, and scopes', () => {
    const base = scopeKeyOf(personal, { kind: 'library' }, 'S1')
    expect(scopeKeyOf(personal, { kind: 'library' }, 'S2')).not.toBe(base)
    expect(scopeKeyOf({ type: 'group', id: 123 }, { kind: 'library' }, 'S1')).not.toBe(base)
    expect(scopeKeyOf(personal, { kind: 'trash' }, 'S1')).not.toBe(base)
  })

  it('gives one collection scope and its alias spelling the same key', () => {
    expect(scopeKeyOf(personal, { kind: 'collection', ref: bare, name: 'Papers' }, 'S1')).toBe(
      scopeKeyOf(personal, { kind: 'collection', ref: qualified, name: 'Papers' }, 'S1'),
    )
  })
})
