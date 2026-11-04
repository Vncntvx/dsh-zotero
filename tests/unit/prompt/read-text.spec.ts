/** The read policy generators: only admitted tools are named. */
import { describe, expect, it } from 'vitest'
import { ZOTERO_READ_TOOL_NAMES } from '../../../src/constants.ts'
import {
  readCapsTextOf,
  readRoutingTextOf,
  ZOTERO_READ_ROUTING_SENTENCE,
} from '../../../src/prompt.ts'

const config = {
  maxSearchResults: 50,
  maxEvidencePassages: 40,
  maxBrowseResults: 30,
  maxExportRefs: 20,
  maxNoteScanRecords: 100,
}

const fullCaps =
  'Tool caps (set on the dsh-zotero configuration page): zotero_search limit up to 50, zotero_retrieve passages up to 40, zotero_browse limit up to 30, and zotero_export refs up to 20. Exceeding a cap errors, so choose limits within these bounds. On the first result page (offset 0) of library/collection scopes, note-body matches are listed separately in supplemental (up to 100 notes scanned), outside the paged total; saved-search scopes never scan note bodies.'

describe('readRoutingTextOf', () => {
  it('renders the canonical route when every read tool is admitted', () => {
    expect(readRoutingTextOf(new Set(ZOTERO_READ_TOOL_NAMES))).toBe(ZOTERO_READ_ROUTING_SENTENCE)
  })

  it('names only zotero_search in a search-only step', () => {
    expect(readRoutingTextOf(new Set(['zotero_search']))).toBe(
      'Read route: zotero_search discovers stable refs.',
    )
  })

  it('keeps a lone match-references clause', () => {
    expect(readRoutingTextOf(new Set(['zotero_match_references']))).toBe(
      'Read route: use zotero_match_references first for Bib/DOI audits.',
    )
  })

  it('keeps a lone get-batch clause', () => {
    expect(readRoutingTextOf(new Set(['zotero_get_batch']))).toBe(
      'Read route: Use zotero_get_batch for known refs.',
    )
  })

  it('keeps a lone get clause', () => {
    expect(readRoutingTextOf(new Set(['zotero_get']))).toBe(
      'Read route: use zotero_get only for ambiguous/conflicting matches or extra child content.',
    )
  })

  it('keeps a lone export clause', () => {
    expect(readRoutingTextOf(new Set(['zotero_export']))).toBe(
      'Read route: For later reads, zotero_export.items[].ref is authoritative; never invent refs or pair by raw export order.',
    )
  })

  it('omits the route for tools it does not route', () => {
    expect(readRoutingTextOf(new Set(['zotero_browse']))).toBeUndefined()
    expect(readRoutingTextOf(new Set(['zotero_changes']))).toBeUndefined()
  })

  it('omits the route for an empty admission', () => {
    expect(readRoutingTextOf(new Set())).toBeUndefined()
  })
})

describe('readCapsTextOf', () => {
  it('renders the canonical caps when every capped tool is admitted', () => {
    expect(readCapsTextOf(new Set(ZOTERO_READ_TOOL_NAMES), config)).toBe(fullCaps)
  })

  it('keeps the note-scan continuation only beside zotero_search', () => {
    const text = readCapsTextOf(new Set(['zotero_search']), config)!
    expect(text).toContain('zotero_search limit up to 50')
    expect(text).toContain('note-body matches')
    expect(text).not.toContain('zotero_browse')
  })

  it('omits the note-scan continuation without zotero_search', () => {
    const text = readCapsTextOf(new Set(['zotero_retrieve']), config)!
    expect(text).toContain('zotero_retrieve passages up to 40')
    expect(text).not.toContain('note-body matches')
  })

  it('joins two caps with and', () => {
    expect(readCapsTextOf(new Set(['zotero_browse', 'zotero_export']), config)).toContain(
      'zotero_browse limit up to 30 and zotero_export refs up to 20',
    )
  })

  it('joins three caps with the Oxford comma', () => {
    expect(
      readCapsTextOf(new Set(['zotero_search', 'zotero_browse', 'zotero_export']), config),
    ).toContain(
      'zotero_search limit up to 50, zotero_browse limit up to 30, and zotero_export refs up to 20',
    )
  })

  it('omits the sentence when no capped tool is admitted', () => {
    expect(readCapsTextOf(new Set(['zotero_get', 'zotero_changes']), config)).toBeUndefined()
  })
})
