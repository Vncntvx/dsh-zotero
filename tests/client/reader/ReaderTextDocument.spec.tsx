// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { ReaderTextDocument } from '../../../src/client/reader/ReaderTextDocument.tsx'
import { makeTranslate } from '../helpers/mock-translate.ts'

const t = makeTranslate(readerEn)

afterEach(cleanup)

function documentRead(text: string, eof = true, format: 'markdown' | 'html' = 'markdown') {
  return vi.fn().mockResolvedValue({
    data: new TextEncoder().encode(text),
    eof,
    path: '/tmp/note.md',
    parentRef: 'zotero://user/0/item/ITEM',
    format,
  })
}

it('renders a markdown document, its outline, search results, and a partial-read note', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  render(
    <ReaderTextDocument
      t={t}
      refString="zotero://user/0/item/ITEM/attachment/ATT"
      title="Reading note"
      sessionId={'session-1' as never}
      tabSignal={new AbortController().signal}
      read={documentRead('# Outline\n\nMethods text', false)}
    />,
  )
  expect(await screen.findByRole('heading', { name: 'Reading note' })).toBeTruthy()
  expect(await screen.findByText(readerEn.documentPartial)).toBeTruthy()
  expect(screen.getAllByText('Outline').length).toBeGreaterThan(0)
  fireEvent.change(screen.getByRole('searchbox', { name: readerEn.documentFind }), {
    target: { value: 'Methods' },
  })
  expect(screen.getAllByRole('status').some((node) => node.textContent?.includes('1'))).toBe(true)
  fireEvent.submit(screen.getByRole('search', { name: readerEn.documentFind }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.findPrevious }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.findNext }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Outline' })[0]!)
})

it('reports a citation that cannot be verified without a fingerprint', async () => {
  render(
    <ReaderTextDocument
      t={t}
      refString="zotero://user/0/item/ITEM/attachment/ATT"
      title="Cited note"
      sessionId={'session-2' as never}
      tabSignal={new AbortController().signal}
      citation={{ documentType: 'markdown', textRange: { start: 0, end: 5 } }}
      read={documentRead('Methods text')}
    />,
  )
  expect(await screen.findByText(readerEn.documentCitationUnverified)).toBeTruthy()
})
