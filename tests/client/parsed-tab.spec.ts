/**
 * The parsed-document tab address: one identity per (session, attachment), and
 * a parse that never throws on a string the page does not own.
 * @module tests/client/parsed-tab
 */

import { describe, expect, it } from 'vitest'
import {
  PARSED_TAB_KIND,
  PARSED_TAB_PATTERN,
  parseParsedTabAddress,
  parsedTabAddress,
} from '../../src/client/parsed-tab.ts'

describe('parsedTabAddress', () => {
  it('round-trips a ref that carries its own query', () => {
    const target = {
      sessionId: 'session-1',
      ref: 'zotero://user/0/attachment/PDF00001?server=S1',
      title: 'A paper.pdf',
    }
    const address = parsedTabAddress(target)
    expect(address.startsWith('dsh-resource://zotero-parsed/')).toBe(true)
    expect(address).not.toContain('?server=S1')
    expect(parseParsedTabAddress(address)).toEqual(target)
  })

  it('matches the glob the tab type registers', () => {
    expect(parsedTabAddress({ sessionId: 's', ref: 'r', title: 't' })).toMatch(
      /^dsh-resource:\/\/zotero-parsed\/.+$/u,
    )
    expect(PARSED_TAB_KIND).toBe('zotero-parsed')
    expect(PARSED_TAB_PATTERN).toBe('dsh-resource://zotero-parsed/**')
  })

  it('carries the item the paper belongs to', () => {
    const target = {
      sessionId: 's',
      ref: 'zotero://user/0/attachment/A1',
      title: 'Paper',
      item: 'zotero://user/0/item/I1',
    }
    expect(parseParsedTabAddress(parsedTabAddress(target))).toEqual(target)
    // An item ref with its own query survives the round trip.
    const queried = { ...target, item: 'zotero://user/0/item/I1?server=S1' }
    expect(parseParsedTabAddress(parsedTabAddress(queried))).toEqual(queried)
  })

  it('reads a missing title as an empty one', () => {
    expect(parseParsedTabAddress('dsh-resource://zotero-parsed/s/r')).toEqual({
      sessionId: 's',
      ref: 'r',
      title: '',
    })
  })

  it('refuses an address it does not own', () => {
    expect(parseParsedTabAddress('dsh-resource://plan/s1/c1')).toBeUndefined()
    expect(parseParsedTabAddress('sidebar://zotero-parsed')).toBeUndefined()
    expect(parseParsedTabAddress('dsh-resource://zotero-parsed/one-segment')).toBeUndefined()
    expect(parseParsedTabAddress('dsh-resource://zotero-parsed//ref')).toBeUndefined()
  })

  it('refuses a malformed escape instead of throwing', () => {
    expect(parseParsedTabAddress('dsh-resource://zotero-parsed/%E0%A4%A/ref')).toBeUndefined()
  })
})
