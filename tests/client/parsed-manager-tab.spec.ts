/** One manager tab per session; malformed addresses never reach the page. */
import { describe, expect, it } from 'vitest'
import {
  PARSED_MANAGER_TAB_KIND,
  PARSED_MANAGER_TAB_PATTERN,
  parseParsedManagerTabAddress,
  parsedManagerTabAddress,
} from '../../src/client/parsed-manager-tab.ts'

describe('parsedManagerTabAddress', () => {
  it('round-trips an opaque session id', () => {
    const address = parsedManagerTabAddress({ sessionId: 'session/one?x=1' })
    expect(address.startsWith('dsh-resource://zotero-parsed-manager/')).toBe(true)
    expect(parseParsedManagerTabAddress(address)).toEqual({ sessionId: 'session/one?x=1' })
  })

  it('reads a query string as presentation, not as the session id', () => {
    const address = `${parsedManagerTabAddress({ sessionId: 's1' })}?title=Paper`
    expect(parseParsedManagerTabAddress(address)).toEqual({ sessionId: 's1' })
  })

  it('matches the registered glob', () => {
    expect(parsedManagerTabAddress({ sessionId: 's' })).toMatch(
      /^dsh-resource:\/\/zotero-parsed-manager\/.+$/u,
    )
    expect(PARSED_MANAGER_TAB_KIND).toBe('zotero-parsed-manager')
    expect(PARSED_MANAGER_TAB_PATTERN).toBe('dsh-resource://zotero-parsed-manager/**')
  })

  it('refuses addresses it does not own', () => {
    expect(parseParsedManagerTabAddress('dsh-resource://plan/s1')).toBeUndefined()
    expect(parseParsedManagerTabAddress('dsh-resource://zotero-parsed-manager/')).toBeUndefined()
    expect(
      parseParsedManagerTabAddress('dsh-resource://zotero-parsed-manager/s1/nested'),
    ).toBeUndefined()
    expect(
      parseParsedManagerTabAddress('dsh-resource://zotero-parsed-manager/%E0%A4%A'),
    ).toBeUndefined()
  })
})
