// @vitest-environment jsdom
/** Menu routing reaches the mounted feed and releases its binding on unmount. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { applyEntry, fakeWorld } from '../helpers/apply-world.ts'
import { mountPanel, searchPage } from '../helpers/library-panel-harness.tsx'
import { ZoteroLibraryMenu } from '../../../src/client/components/library/ZoteroLibraryMenu.tsx'
import type {
  ZoteroLibraryPanelFace,
  ZoteroLibraryPanelProps,
} from '../../../src/client/components/library/ZoteroLibraryPanel.tsx'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(cleanup)
it('menu click refreshes the target feed and displays the new server data', async () => {
  const world = fakeWorld()
  await applyEntry(world)
  world.injected.find((e) => e.name === 'sidebar.right.pane.tab')!.register()
  world.injected.find((e) => e.name === 'sidebar.right.tab.menu.item')!.register()
  const panel = world.registered.find((e) => e.name === 'sidebar.right.pane.tab')!
  const menu = world.registered.find((e) => e.name === 'sidebar.right.tab.menu.item')!
  const face = (panel.options.inject as () => ZoteroLibraryPanelFace)()
  const { onRefresh } = (
    menu.options.inject as () => { onRefresh: (sessionId: string, tabId: string) => void }
  )()
  let title = 'Before refresh'
  const search = vi.fn(async () => ({
    ok: true,
    value: searchPage({ items: [{ ...searchPage().items[0]!, title }] }),
  }))
  // TabInfo is an external surface stub; only identity is consumed here.
  const useTabInfo = (() => ({
    tab: { id: 'library-tab' },
  })) as ZoteroLibraryPanelProps['useTabInfo']
  const mounted = mountPanel({ search }, undefined, { bindRefresh: face.bindRefresh, useTabInfo })
  await screen.findByText('Before refresh')
  const dismiss = vi.fn()
  render(
    <ZoteroLibraryMenu
      tab={{ id: 'library-tab', kind: 'zotero-library' }}
      sessionId="s1"
      dismiss={dismiss}
      onRefresh={onRefresh}
      t={mockT}
    />,
  )
  title = 'After refresh'
  fireEvent.click(screen.getByRole('button', { name: mockT('libraryMenuRefresh') }))
  await screen.findByText('After refresh')
  expect(dismiss).toHaveBeenCalledOnce()
  const count = search.mock.calls.length
  act(() => onRefresh('another-session', 'library-tab'))
  expect(search).toHaveBeenCalledTimes(count)
  mounted.view.unmount()
  act(() => onRefresh('s1', 'library-tab'))
  expect(search).toHaveBeenCalledTimes(count)
})
