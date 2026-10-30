// @vitest-environment jsdom
import { deferred } from '../../helpers/sync.ts'
import type { LibraryFeedFace } from '../../../src/client/components/library/library-feed-types.ts'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mountPanel, searchPage } from '../helpers/library-panel-harness.tsx'
import { writeLibraryState } from '../../../src/client/components/library/library-storage.ts'
import { zh } from '../../../src/client/locales.ts'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
it('renders active-filter empty results distinctly and keeps clear filters visible', async () => {
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: { kind: 'library' },
    q: '',
    filters: { tags: ['read'], yearFrom: 2020 },
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
  mountPanel({
    search: vi.fn(async () => ({
      ok: true,
      value: searchPage({ items: [], total: 0, returned: 0 }),
    })),
  })
  expect(await screen.findByText(zh.libraryNoMatches)).toBeTruthy()
})
it('offers location in the list after selecting a collection', async () => {
  const { face } = mountPanel()
  fireEvent.click(await screen.findByText('LLM Papers'))
  fireEvent.click(screen.getByRole('button', { name: zh.libraryLocate }))
  await waitFor(() => expect(face.collectionPath).toHaveBeenCalled())
})

it('lets the user explicitly leave a missing collection for all items', async () => {
  const search = vi.fn(async (request: { scope: { kind: string } }) =>
    request.scope.kind === 'collection'
      ? { ok: false, error: { message: 'Collection deleted' } }
      : { ok: true, value: searchPage() },
  )
  mountPanel({ search })
  fireEvent.click(await screen.findByText('LLM Papers'))
  expect(await screen.findByText('Collection deleted')).toBeTruthy()
  const buttons = screen.getAllByRole('button', { name: zh.libraryAllItems })
  fireEvent.click(buttons.at(-1)!)
  expect(await screen.findByText('FlashAttention-2')).toBeTruthy()
})

it('keeps the restored name visible while its fresh collection path is pending', async () => {
  writeLibraryState('S1', {
    version: 2,
    library: { type: 'user', id: 0 },
    selection: {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0001',
      name: 'Restored collection',
    },
    q: '',
    filters: {},
    mode: 'metadata',
    sort: 'title',
    direction: 'asc',
    offset: 0,
    expanded: [],
  })
  const path = deferred<Awaited<ReturnType<LibraryFeedFace['collectionPath']>>>()
  mountPanel({ collectionPath: vi.fn(() => path.promise) })
  expect(await screen.findByRole('heading', { name: 'Restored collection' })).toBeTruthy()
  await act(async () => path.reject(new Error('path unavailable')))
})
it('does not send navigation requests when refresh confirms the panel is offline', async () => {
  const { face } = mountPanel({
    status: vi.fn(async () => ({ ok: true, value: { connected: false, provider: 'local' } })),
  })
  await waitFor(() => expect(face.status).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
  await waitFor(() => expect(face.status).toHaveBeenCalledTimes(2))
  expect(face.browse).not.toHaveBeenCalled()
})
