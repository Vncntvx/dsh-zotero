import { describe, expect, it } from 'vitest'
import ZoteroService, {
  NOT_RUNNING_MESSAGE,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_FILE_MISSING,
  ZOTERO_INVALID_REF,
  ZOTERO_NOT_FOUND,
  ZOTERO_NO_FULLTEXT,
  ZOTERO_NOT_RUNNING,
  ZOTERO_OUTPUT_TOO_LARGE,
  ZOTERO_PROVIDER_UNAVAILABLE,
  ZOTERO_SERVER_MISMATCH,
  ZOTERO_TIMEOUT,
  ZoteroError,
} from '../src/index.js'
import type { ZoteroSearchRequest, ZoteroSortField } from '../src/index.js'

describe('package entry exports', () => {
  it('default-exports the service class', () => {
    expect(ZoteroService.name).toBe('ZoteroService')
  })

  it('exposes the full error vocabulary for typed failure routing', () => {
    expect(ZOTERO_INVALID_REF).toBe('ZOTERO_INVALID_REF')
    expect(ZOTERO_NOT_RUNNING).toBe('ZOTERO_NOT_RUNNING')
    expect(ZOTERO_SERVER_MISMATCH).toBe('ZOTERO_SERVER_MISMATCH')
    expect(ZOTERO_NOT_FOUND).toBe('ZOTERO_NOT_FOUND')
    expect(ZOTERO_NO_FULLTEXT).toBe('ZOTERO_NO_FULLTEXT')
    expect(ZOTERO_FILE_MISSING).toBe('ZOTERO_FILE_MISSING')
    expect(ZOTERO_TIMEOUT).toBe('ZOTERO_TIMEOUT')
    expect(ZOTERO_OUTPUT_TOO_LARGE).toBe('ZOTERO_OUTPUT_TOO_LARGE')
    expect(ZOTERO_CAPABILITY_UNAVAILABLE).toBe('ZOTERO_CAPABILITY_UNAVAILABLE')
    expect(ZOTERO_PROVIDER_UNAVAILABLE).toBe('ZOTERO_PROVIDER_UNAVAILABLE')
    expect(NOT_RUNNING_MESSAGE).toContain('Settings')
  })

  it('exports the typed error class and the domain types', () => {
    const error = new ZoteroError('boom', ZOTERO_NOT_FOUND)
    expect(error.code).toBe('ZOTERO_NOT_FOUND')
    const request: ZoteroSearchRequest = {
      scope: { kind: 'library' },
      mode: 'metadata',
      sort: 'dateModified' satisfies ZoteroSortField,
      direction: 'desc',
      offset: 0,
      limit: 5,
    }
    expect(request.sort).toBe('dateModified')
  })
})
