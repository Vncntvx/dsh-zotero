// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../../../src/client/reader/reading-history.ts'
import { mountPanel } from '../helpers/library-panel-harness.tsx'
import { searchPage } from '../helpers/library-panel-fixtures.ts'

afterEach(cleanup)

it('updates the last read date for the qualified parent and clears it on revocation', async () => {
  const ref = 'zotero://user/0/item/ITEM0001?server=S1'
  const page = searchPage()
  const row = { ...page.items[0]!, ref }
  const readingVisits = createSnapshotStore<readonly HistoryEntry[]>([])
  const { face } = mountPanel(
    { search: vi.fn().mockResolvedValue({ ok: true, value: { ...page, items: [row] } }) },
    undefined,
    { readingVisits },
  )
  const element = (await screen.findByText(row.title)).closest('li')!
  const visit = {
    attachmentRef: 'zotero://user/0/attachment/ATTAC001?server=S1',
    itemRef: ref,
    fingerprint: 'copy-1',
    pageIndex: 0,
    pageOffset: 0,
    zoom: 1,
    fitMode: 'width',
    rotation: 0,
    panels: { outline: false, info: false },
    readingSeconds: 5,
    lastVisitedAt: 1000,
  } satisfies HistoryEntry
  const searchCount = face.search.mock.calls.length
  act(() =>
    readingVisits.set([{ ...visit, attachmentRef: visit.attachmentRef.replace('S1', 'S2') }]),
  )
  expect(element.querySelector('time')).toBeNull()
  act(() => readingVisits.set([visit]))
  expect(element.querySelector('time')?.dateTime).toBe(new Date(visit.lastVisitedAt).toISOString())
  act(() => readingVisits.set([]))
  expect(element.querySelector('time')).toBeNull()
  expect(face.search).toHaveBeenCalledTimes(searchCount)
})
