// @vitest-environment jsdom
/**
 * The library item list hands every row the `zoteroItem` context-menu target.
 * @module tests/client/library/library-item-context-menu
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { mountPanel, searchPage } from '../helpers/library-panel-harness.tsx'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

it('hands each item row the canonical zoteroItem target', async () => {
  const { contextMenuTargets } = mountPanel()
  await screen.findByText('FlashAttention-2')

  expect(contextMenuTargets).toContainEqual({
    kind: 'zoteroItem',
    value: {
      ref: 'zotero://user/0/item/ITEM0001',
      title: 'FlashAttention-2',
      itemType: 'conferencePaper',
      addToChat: expect.any(Function),
    },
  })
})

it('inserts multiple item capsules in the tab’s conversation and persists each accepted insert', async () => {
  const page = searchPage()
  const search = vi.fn(async () => ({
    ok: true,
    value: {
      ...page,
      items: [
        { ...page.items[0], venue: undefined, publicationTitle: 'NeurIPS', doi: '10.1234/paper' },
        page.items[1],
      ],
    },
  }))
  const { contextMenuTargets, inputActions, face } = mountPanel(
    { search },
    {
      ids: ['first', 'tab-session'],
      byId: {},
      paneId: 'tab-session',
    },
  )
  await screen.findByText('FlashAttention-2')
  await screen.findByText('Tree of Thoughts')

  const capturedItem = (title: string) => {
    const target = contextMenuTargets.find(
      (entry) => entry.kind === 'zoteroItem' && entry.value.title === title,
    )
    if (target?.kind !== 'zoteroItem') throw new Error(`Menu target missing for ${title}`)
    return target.value
  }
  const first = capturedItem('FlashAttention-2')
  const second = capturedItem('Tree of Thoughts')
  expect(first.addToChat?.()).toBe(true)
  expect(second.addToChat?.()).toBe(true)
  expect(inputActions.insertQuote.mock.calls).toEqual([
    [
      'FlashAttention-2\nTri Dao\n2023 · NeurIPS\nDOI: 10.1234/paper\nzotero://user/0/item/ITEM0001',
      {
        label: 'FlashAttention-2',
        title: 'FlashAttention-2',
        detail: '2023 · NeurIPS',
        body: 'Tri Dao',
      },
    ],
    [
      'Tree of Thoughts\nShunyu Yao\n2023\nzotero://user/0/item/ITEM0002',
      {
        label: 'Tree of Thoughts',
        title: 'Tree of Thoughts',
        detail: '2023',
        body: 'Shunyu Yao',
      },
    ],
  ])
  inputActions.insertQuote.mockReturnValueOnce(false)
  expect(first.addToChat?.()).toBe(false)
  expect(inputActions.persistDraft).toHaveBeenCalledTimes(2)
  expect(inputActions.setDraft).not.toHaveBeenCalled()
  expect(inputActions.submit).not.toHaveBeenCalled()
  expect(face.item).not.toHaveBeenCalled()
})

it('uses an untitled item’s ref and refuses an action captured by a closed tab', async () => {
  const tab = new AbortController()
  const page = searchPage()
  const item = { ...page.items[1], title: '', year: undefined }
  const search = vi.fn(async () => ({ ok: true, value: { ...page, items: [item], total: 1 } }))
  const { contextMenuTargets, inputActions } = mountPanel({ search }, undefined, {
    useTabInfo: (() => ({ tab: { id: 'library', signal: tab.signal } })) as never,
  })
  await screen.findByText(item.ref)

  const target = contextMenuTargets.find((entry) => entry.kind === 'zoteroItem')
  if (target?.kind !== 'zoteroItem') throw new Error('Missing item menu target')
  expect(target.value.addToChat?.()).toBe(true)
  expect(inputActions.insertQuote).toHaveBeenCalledWith(`Shunyu Yao\n${item.ref}`, {
    label: item.ref,
    title: item.ref,
    detail: undefined,
    body: 'Shunyu Yao',
  })
  tab.abort()
  expect(target.value.addToChat?.()).toBe(false)
  expect(inputActions.insertQuote).toHaveBeenCalledTimes(1)
})

it('captures only the item identity when the tab has no composer', async () => {
  const { contextMenuTargets } = mountPanel({}, undefined, { inputActions: undefined })
  await screen.findByText('FlashAttention-2')
  expect(contextMenuTargets).toContainEqual({
    kind: 'zoteroItem',
    value: {
      ref: 'zotero://user/0/item/ITEM0001',
      title: 'FlashAttention-2',
      itemType: 'conferencePaper',
    },
  })
})

it('renders item list gracefully when useContextMenu is unavailable', async () => {
  mountPanel({}, undefined, { useContextMenu: undefined })
  await expect(screen.findByText('FlashAttention-2')).resolves.toBeDefined()
})
