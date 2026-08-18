/**
 * Plain source actions: the copyable citation line and the prefill
 * templates.
 * @module tests/client/actions/source-actions
 */

import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { askDraftOf, exportDraftOf } from '../../../src/client/actions/source-actions.ts'
import { zh, type ZoteroLocaleKey } from '../../../src/client/locales.ts'
import type { SourceItem } from '../../../src/client/sources/model.ts'
import { sourceOf } from '../helpers/source-fixtures.ts'

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

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
