import { expect, it } from 'vitest'
import {
  ATTACHMENT_BUDGET_EXHAUSTED_NOTE,
  ATTACHMENT_LIMIT_NOTE,
  ATTACHMENT_NO_PASSAGES_NOTE,
  NO_SOURCES_MESSAGE,
  renderRetrieve,
} from '../../src/tools/retrieve.js'

const render = (value: Record<string, unknown>): string =>
  (renderRetrieve({} as never, value as never)[0] as { text: string }).text

it('explains why indexed attachments can yield no usable passage', () => {
  const text = render({
    ref: 'zotero://user/0/item/ABCD1234',
    evidence: [],
    noMatch: 'no-sources',
    truncated: false,
    sourcesSkipped: [],
    attachments: [
      {
        ref: 'zotero://user/0/attachment/STAR0001',
        status: 'indexed',
        coverage: { indexedChars: 4096, complete: false },
        passages: 0,
        inputTruncated: true,
      },
      { ref: 'zotero://user/0/attachment/EMPTY001', status: 'indexed', passages: 0 },
    ],
  })
  expect(text).toContain(
    `- zotero://user/0/attachment/STAR0001: ${ATTACHMENT_BUDGET_EXHAUSTED_NOTE}, 4096/? chars indexed`,
  )
  expect(text).toContain(`- zotero://user/0/attachment/EMPTY001: ${ATTACHMENT_NO_PASSAGES_NOTE}`)
  expect(text).toContain(NO_SOURCES_MESSAGE)
})

it('keeps the cut wording for a source that was read and truncated', () => {
  const text = render({
    ref: 'zotero://user/0/item/ABCD1234',
    evidence: [],
    truncated: false,
    sourcesSkipped: [],
    attachments: [
      {
        ref: 'zotero://user/0/attachment/PART0002',
        status: 'indexed',
        coverage: { indexedChars: 4096, complete: false },
        passages: 2,
        inputTruncated: true,
      },
      {
        ref: 'zotero://user/0/attachment/OVER0003',
        status: 'unread',
      },
    ],
  })
  expect(text).toContain(
    '- zotero://user/0/attachment/PART0002: 2 passages, 4096/? chars indexed, text cut',
  )
  expect(text).toContain(`- zotero://user/0/attachment/OVER0003: ${ATTACHMENT_LIMIT_NOTE}`)
})
