/**
 * Plain source actions: the copyable citation line and the prefill
 * templates.
 * @module tests/client/actions/source-actions
 */

import { describe, expect, it } from 'vitest'
import { askDraftOf, exportDraftOf } from '../../../src/client/actions/source-actions.ts'
import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

describe('prefill templates', () => {
  it('interpolates the ask and export drafts', () => {
    expect(askDraftOf('zotero://user/0/item/A', t)).toBe(
      mockT('askTemplate', { ref: 'zotero://user/0/item/A' }),
    )
    expect(exportDraftOf('zotero://user/0/item/A', t)).toBe(
      mockT('citeTemplate', { ref: 'zotero://user/0/item/A' }),
    )
  })
})
