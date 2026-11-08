// @vitest-environment jsdom
/**
 * The library item list hands every row the `zoteroItem` context-menu target.
 * @module tests/client/library/library-item-context-menu
 */

import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { mountPanel } from '../helpers/library-panel-harness.tsx'

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
    },
  })
})

it('renders item list gracefully when useContextMenu is unavailable', async () => {
  mountPanel({}, undefined, { useContextMenu: undefined })
  await expect(screen.findByText('FlashAttention-2')).resolves.toBeDefined()
})
