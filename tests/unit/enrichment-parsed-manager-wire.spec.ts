/** The management wire carries only safe displays; complete URLs stay on the host. */
import { describe, expect, it } from 'vitest'
import {
  zoteroListParsedDocumentsRequestSchema,
  zoteroListParsedDocumentsResultSchema,
  zoteroDiscardParsedDocumentRequestSchema,
  zoteroDiscardParsedDocumentResultSchema,
  zoteroParseTargetSchema,
} from '../../src/wire-schemas.ts'
import { ZOTERO_COMMON_INVOCATIONS } from '../../src/wire-schemas.ts'
import {
  ZOTERO_LIST_PARSED_DOCUMENTS_METHOD,
  ZOTERO_DISCARD_PARSED_DOCUMENT_METHOD,
} from '../../src/contract.ts'

const ID = 'a'.repeat(64)
const row = {
  artifactId: ID,
  state: 'indexed',
  sourceKind: 'url',
  targetLabel: 'https://papers.example.org/…',
  mode: 'free',
  generation: '11111111-1111-4111-8111-111111111111',
  fingerprint: 'f'.repeat(64),
  characterCount: 12,
  images: [],
  markdownBytes: 12,
  committedAt: 1_700_000_000_000,
  aliases: [ID],
  actionable: true,
}

describe('parsed document management wire', () => {
  it('registers both endpoints in the shared invocation table', () => {
    const methods = ZOTERO_COMMON_INVOCATIONS.map((invocation) => invocation.method)
    expect(methods).toContain(ZOTERO_LIST_PARSED_DOCUMENTS_METHOD)
    expect(methods).toContain(ZOTERO_DISCARD_PARSED_DOCUMENT_METHOD)
  })

  it('accepts an opaque artifact target but no URL in a list result', () => {
    expect(zoteroParseTargetSchema.parse({ kind: 'artifact', artifactId: ID })).toEqual({
      kind: 'artifact',
      artifactId: ID,
    })
    const parsed = zoteroListParsedDocumentsResultSchema.parse({ rows: [row], total: 1 })
    expect(parsed.rows[0]!.targetLabel).toBe('https://papers.example.org/…')
    expect(JSON.stringify(parsed)).not.toContain('token=')
  })

  it('bounds the page and rejects a malformed artifact id', () => {
    expect(
      zoteroListParsedDocumentsRequestSchema.safeParse({
        sessionId: 's1',
        offset: 0,
        limit: 201,
      }).success,
    ).toBe(false)
    expect(
      zoteroDiscardParsedDocumentRequestSchema.safeParse({
        sessionId: 's1',
        artifactId: 'not-a-sha',
      }).success,
    ).toBe(false)
  })

  it('narrows a page by state and trimmed text, and refuses anything else', () => {
    const narrowed = zoteroListParsedDocumentsRequestSchema.parse({
      sessionId: 's1',
      offset: 0,
      limit: 50,
      state: 'orphan',
      query: '  attention  ',
    })
    expect(narrowed).toEqual({
      sessionId: 's1',
      offset: 0,
      limit: 50,
      state: 'orphan',
      query: 'attention',
    })
    const refused = (request: Record<string, unknown>) =>
      zoteroListParsedDocumentsRequestSchema.safeParse(request).success
    expect(refused({ sessionId: 's1', offset: 0, limit: 50, state: 'stale' })).toBe(false)
    expect(refused({ sessionId: 's1', offset: 0, limit: 50, query: '   ' })).toBe(false)
    expect(refused({ sessionId: 's1', offset: 0, limit: 50, query: 'a'.repeat(201) })).toBe(false)
    expect(refused({ sessionId: 's1', offset: 0, limit: 50, filter: 'indexed' })).toBe(false)
  })

  it('carries the captured title as an optional non-empty row field', () => {
    const titled = zoteroListParsedDocumentsResultSchema.parse({
      rows: [{ ...row, title: 'Attention Is All You Need' }],
      total: 1,
    })
    expect(titled.rows[0]!.title).toBe('Attention Is All You Need')
    expect(
      zoteroListParsedDocumentsResultSchema.safeParse({ rows: [{ ...row, title: '' }], total: 1 })
        .success,
    ).toBe(false)
  })

  it('keeps the discard result a closed union', () => {
    expect(zoteroDiscardParsedDocumentResultSchema.parse({ kind: 'missing' })).toEqual({
      kind: 'missing',
    })
    expect(
      zoteroDiscardParsedDocumentResultSchema.parse({
        kind: 'discarded',
        removedAliases: 3,
        removedReceipts: 1,
      }),
    ).toEqual({ kind: 'discarded', removedAliases: 3, removedReceipts: 1 })
  })
})
