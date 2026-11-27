// @vitest-environment jsdom
/**
 * Reader details: reopening a recent PDF, refusing an unreadable sibling, and
 * rendering the minimal record. Main details rendering lives in
 * `ReaderDetails.spec.tsx`.
 * @module tests/client/reader/ReaderDetails.sessions
 */

import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderDetails } from '../../../src/client/reader/ReaderDetails.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HistoryEntry } from '../../../src/client/reader/reading-history.ts'

import { current, details, mount, translated } from './support/reader-details.tsx'

afterEach(cleanup)

it('reopens a recent PDF from the same qualified library after resolving it again', async () => {
  const documentRef = `${current.ref}?server=instance-a`
  const ref = `${translated.ref}?server=instance-a`
  const visit = {
    attachmentRef: ref,
    title: 'Recent paper',
    fingerprint: 'copy-1',
    pageIndex: 4,
    pageOffset: 0,
    fitMode: 'width',
    zoom: 1,
    rotation: 0,
    panels: { outline: false, info: true },
    readingSeconds: 12,
    lastVisitedAt: 1000,
  } satisfies HistoryEntry
  const visits = createSnapshotStore<readonly HistoryEntry[]>([
    { ...visit, attachmentRef: documentRef, title: 'Current paper' },
    { ...visit, attachmentRef: ref.replace('instance-a', 'instance-b'), title: 'Other server' },
    { ...visit, attachmentRef: ref.replace('user/0', 'group/123'), title: 'Other library' },
    visit,
  ])
  const { resolve, onSwitch } = mount({
    documentRef,
    visits,
    resolve: vi.fn().mockResolvedValue({ ref, path: 'fixtures/translated.pdf' }),
  })
  fireEvent.click(await screen.findByText(readerEn.recentReading))
  expect(screen.queryByText(/Current paper|Other server|Other library/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Recent paper' }))
  await act(async () => {})

  expect(resolve).toHaveBeenCalledExactlyOnceWith(ref, expect.any(AbortSignal))
  expect(onSwitch).toHaveBeenCalledExactlyOnceWith({ ref, title: 'Recent paper' })
})

it('keeps the current PDF open when the sibling attachment cannot be read', async () => {
  const read = vi.fn<Parameters<typeof ReaderDetails>[0]['details']>().mockResolvedValue({
    ...details,
    attachments: { offset: 0, limit: 2, total: 2, returned: 2, items: [current, translated] },
  })
  const { onSwitch } = mount({ details: read, resolve: vi.fn().mockRejectedValue(new Error()) })
  fireEvent.click(await screen.findByRole('button', { name: translated.title }))
  expect((await screen.findByRole('alert')).textContent).toContain(translated.title)
  expect(onSwitch).not.toHaveBeenCalled()
})

it('renders a minimal record without optional citations, notes, metrics, or attachment switching', async () => {
  mount({
    switchingDisabled: true,
    details: vi.fn().mockResolvedValue({
      ref: details.ref,
      itemType: 'journalArticle',
      title: 'Bare record',
      creators: [],
      tags: [],
      collections: [],
      children: { total: 0 },
      attachments: { offset: 0, limit: 1, total: 0, returned: 0, items: [] },
    }),
  })
  expect(await screen.findByText('Bare record')).toBeTruthy()
  expect(screen.queryByRole('button', { name: readerEn.quoteAbstract })).toBeNull()
  expect(screen.queryByRole('button', { name: readerEn.more })).toBeNull()
})
