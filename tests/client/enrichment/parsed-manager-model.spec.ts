/**
 * Pure row derivations behind the manager's rows: the short id, the source
 * descriptor, the byte total and the last page index.
 * @module tests/client/enrichment/parsed-manager-model
 */

import { describe, expect, it } from 'vitest'
import type { ZoteroParsedDocumentRowView } from '../../../src/contract.ts'
import {
  maxPageOf,
  shortArtifactId,
  sourceDescriptorOf,
  totalBytesOf,
} from '../../../src/client/enrichment/parsed-manager-model.ts'

function rowOf(overrides: Partial<ZoteroParsedDocumentRowView> = {}): ZoteroParsedDocumentRowView {
  return {
    artifactId: 'a'.repeat(64),
    state: 'indexed',
    sourceKind: 'attachment',
    targetLabel: 'zotero://user/0/attachment/PDF00001',
    mode: 'free',
    generation: '',
    fingerprint: '',
    characterCount: 10,
    images: [],
    markdownBytes: 100,
    committedAt: 1,
    aliases: [],
    actionable: true,
    ...overrides,
  }
}

describe('shortArtifactId', () => {
  it('keeps the first eight characters of the id', () => {
    expect(shortArtifactId('abcdef0123456789')).toBe('abcdef01')
  })
})

describe('sourceDescriptorOf', () => {
  it('names an attachment by its key and drops the server query', () => {
    expect(
      sourceDescriptorOf(rowOf({ targetLabel: 'zotero://user/0/attachment/PDF00001?server=S1' })),
    ).toBe('PDF00001')
  })

  it('keeps the origin-only label a URL row already carries', () => {
    expect(
      sourceDescriptorOf(rowOf({ sourceKind: 'url', targetLabel: 'https://papers.example.org/…' })),
    ).toBe('https://papers.example.org/…')
  })

  it('has no descriptor for a broken row', () => {
    expect(sourceDescriptorOf(rowOf({ state: 'broken', targetLabel: '' }))).toBe('')
  })
})

describe('totalBytesOf', () => {
  it('adds every retained figure to the Markdown size', () => {
    expect(
      totalBytesOf(
        rowOf({
          markdownBytes: 900,
          images: [
            { name: 'images/a.png', mediaType: 'image/png', bytes: 60 },
            { name: 'images/b.png', mediaType: 'image/png', bytes: 40 },
          ],
        }),
      ),
    ).toBe(1000)
  })
})

describe('maxPageOf', () => {
  it('counts the last page index, with an empty listing on page zero', () => {
    expect(maxPageOf(0, 50)).toBe(0)
    expect(maxPageOf(50, 50)).toBe(0)
    expect(maxPageOf(51, 50)).toBe(1)
    expect(maxPageOf(100, 50)).toBe(1)
  })
})
