/**
 * The fulltext-mode retrieve projection: a complete-document window becomes
 * its own compact trail fact and never carries the window text into meta.
 * @module tests/unit/presentation-meta-fulltext
 */

import { describe, expect, it } from 'vitest'
import { projectRetrieveMeta } from '../../src/presentation-meta.js'
import type { ZoteroFulltextRetrieveResult } from '../../src/types.js'

function fulltextResult(): ZoteroFulltextRetrieveResult {
  return {
    mode: 'fulltext',
    fulltext: {
      sourceKind: 'url',
      sourceLabel: 'artifact 1234abcd…',
      textFormat: 'markdown',
      totalChars: 40_000,
      inputTruncated: false,
      start: 0,
      end: 12_000,
      text: 'x'.repeat(12_000),
      isTruncated: true,
      nextStart: 12_000,
      spillAvailable: false,
    },
  }
}

describe('fulltext projection', () => {
  it('projects a fulltext window as its own fact without carrying the text', () => {
    // The tool always enters the projector with the full requested-source
    // list (args.sources ?? ALL_SOURCES); the fulltext arm ignores it, so the
    // projection must stay evidence-free even under the production shape.
    const meta = projectRetrieveMeta(fulltextResult(), [
      'annotation',
      'note',
      'abstract',
      'fulltext',
    ])
    if (meta.mode !== 'fulltext') throw new Error('expected a fulltext projection')
    expect(meta.fulltextRead).toEqual({
      sourceKind: 'url',
      sourceLabel: 'artifact 1234abcd…',
      textFormat: 'markdown',
      totalChars: 40_000,
      inputTruncated: false,
      start: 0,
      end: 12_000,
      isTruncated: true,
      spillAvailable: false,
    })
    expect(JSON.stringify(meta.fulltextRead)).not.toContain('xxxx')
    // The arm carries nothing evidence-shaped: no count, sources, budget flag,
    // availability, or attachment deep link.
    expect(Object.keys(meta).sort()).toEqual(['fulltextRead', 'mode'])
  })
})
