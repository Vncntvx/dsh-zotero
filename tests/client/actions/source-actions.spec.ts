/**
 * Plain source actions: the copyable citation line and the prefill
 * templates.
 * @module tests/client/actions/source-actions
 */

import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  askDraftOf,
  citationLineOf,
  exportDraftOf,
} from '../../../src/client/actions/source-actions.ts'
import { zh, type ZoteroLocaleKey } from '../../../src/client/locales.ts'
import type { SourceItem } from '../../../src/client/sources/model.ts'

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

function itemOf(overrides: Partial<SourceItem>): SourceItem {
  return {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    provenance: 'unknown',
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [],
    evidence: [],
    exports: [],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    callRefs: { successful: [], failed: [], running: [] },
    ...overrides,
  }
}

describe('citationLineOf', () => {
  it('joins creators, year, title, and venue', () => {
    expect(
      citationLineOf(
        itemOf({ creators: 'Dao', year: 2023, title: 'FlashAttention-2', venue: 'ICLR' }),
      ),
    ).toBe('Dao. · 2023 · FlashAttention-2 · ICLR.')
  })

  it('omits the fields the session never proved', () => {
    expect(citationLineOf(itemOf({ title: 'Only Title' }))).toBe('Only Title')
  })
})

describe('prefill templates', () => {
  it('interpolates the ask and export drafts', () => {
    expect(askDraftOf('zotero://user/0/item/A', t)).toBe(
      zh.askTemplate.replace('{ref}', 'zotero://user/0/item/A'),
    )
    expect(exportDraftOf('zotero://user/0/item/A', t)).toBe(
      zh.citeTemplate.replace('{ref}', 'zotero://user/0/item/A'),
    )
  })
})
