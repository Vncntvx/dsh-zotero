import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { ZoteroItemDetailView } from '../../../../src/contract.ts'
import { ReaderDetails } from '../../../../src/client/reader/ReaderDetails.tsx'
import { readerEn } from '../../../../src/client/reader/locales.ts'
import { attachmentRef, itemRef } from '../../../helpers/server/keys.ts'
import { makeTranslate } from '../../helpers/mock-translate.ts'

export const current = { ref: attachmentRef(), title: 'Original', contentType: 'application/pdf' }
export const translated = {
  ref: attachmentRef('TRANSL01'),
  title: 'Translation',
  contentType: 'application/pdf',
}
export const details = {
  ref: itemRef(),
  itemType: 'journalArticle',
  title: 'Example research paper',
  creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Ng' }],
  date: '2026',
  venue: 'Example Journal',
  doi: '10.0000/example',
  abstract: 'Read the abstract before switching files.',
  abstractTruncated: false,
  tags: ['Methods'],
  collections: [{ ref: 'collection', name: 'Examples' }],
  children: { total: 2 },
  attachments: { offset: 0, limit: 1, total: 2, returned: 1, nextOffset: 1, items: [current] },
} satisfies ZoteroItemDetailView

export function mount(overrides: Partial<Parameters<typeof ReaderDetails>[0]> = {}) {
  const tab = new AbortController()
  const props = {
    t: makeTranslate(readerEn),
    sessionId: 'reader-session',
    documentRef: current.ref,
    tabSignal: tab.signal,
    details: vi.fn<Parameters<typeof ReaderDetails>[0]['details']>().mockResolvedValue(details),
    resolve: vi.fn<Parameters<typeof ReaderDetails>[0]['resolve']>(),
    switchingDisabled: false,
    onSwitch: vi.fn(),
    ...overrides,
  }
  const view = render(<ReaderDetails {...props} />)
  return { ...view, ...props }
}
