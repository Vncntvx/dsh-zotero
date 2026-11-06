/**
 * Unified context menu tests: library-panel lifetime, bibliography file action,
 * and Zotero item actions.
 * @module tests/client/context-menu
 */

import { describe, expect, it, vi } from 'vitest'
import { fakeWorld, applyEntry } from './helpers/apply-world.ts'
import { failOpenProtocol } from './helpers/remote-stubs.ts'

const { writeClipboard } = vi.hoisted(() => ({ writeClipboard: vi.fn(async () => true) }))

// Stub the primitive visuals but keep the real form model: `applyEntry` builds
// the plugin's settings-card controllers, which construct `SettingsFormModel`.
// The clipboard spy is owned here so the copy action's acceptance/refusal arms
// are both observable.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal, { writeClipboard })
})

describe('unified context menus', () => {
  it('registers file and zoteroItem contributions while the library panel is mounted', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const fileMenu = world.contextMenuRegistrations.find((reg) => reg.target === 'file')
    expect(fileMenu).toBeDefined()
    expect(fileMenu?.id).toBe('dsh-zotero.file')
    expect(fileMenu?.order).toBe(150)

    // The desktop hand-off and the clipboard copy are separate
    // contributions: the first calls a global Remote endpoint and is gated on
    // that grant, the second is a local clipboard write.
    const openMenu = world.contextMenuRegistrations.find((reg) => reg.id === 'dsh-zotero.item.open')
    expect(openMenu).toBeDefined()
    expect(openMenu?.target).toBe('zoteroItem')
    expect(openMenu?.order).toBe(100)

    const copyMenu = world.contextMenuRegistrations.find((reg) => reg.id === 'dsh-zotero.item.copy')
    expect(copyMenu).toBeDefined()
    expect(copyMenu?.target).toBe('zoteroItem')
    expect(copyMenu?.order).toBe(110)
  })

  it('withdraws the desktop hand-off when the openProtocol grant is missing', async () => {
    const world = fakeWorld()
    world.grantedActions.delete('zotero/openProtocol')
    await applyEntry(world)

    expect(
      world.contextMenuRegistrations.find((reg) => reg.id === 'dsh-zotero.item.open'),
    ).toBeUndefined()
    expect(
      world.contextMenuRegistrations.find((reg) => reg.id === 'dsh-zotero.item.copy'),
    ).toBeDefined()
  })

  it('withdraws both contributions when the library component is not composed', async () => {
    const world = fakeWorld()
    world.servedNamespaces = new Set(['zotero', 'scholarly'])
    await applyEntry(world)

    expect(world.contextMenuRegistrations).toEqual([])
  })

  it('withdraws both contributions when the right sidebar is disabled', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.contextMenuRegistrations).toHaveLength(3)

    await world.libraryScope.set('rightSidebarEnabled', false)
    expect(world.contextMenuRegistrations).toEqual([])
    expect(world.contextMenuDisposes).toBe(3)
  })

  it('offers openInLibrary for bibliography files and declines others', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const fileMenu = world.contextMenuRegistrations.find((reg) => reg.target === 'file')!
    const signal = new AbortController().signal

    expect(fileMenu.resolve({ sessionId: 's1', path: '/path/to/paper.pdf' }, signal)).toEqual([])
    expect(fileMenu.resolve({ sessionId: 's1', path: '/path/to/script.py' }, signal)).toEqual([])

    const bibActions = fileMenu.resolve({ sessionId: 's1', path: '/path/to/refs.bib' }, signal)
    expect(bibActions).toHaveLength(1)
    expect(bibActions[0].id).toBe('openInLibrary')
    expect(bibActions[0].icon).toEqual({ key: 'zotero.library' })

    bibActions[0].run()
    expect(world.openTabCalls).toEqual([{ sessionId: 's1', kind: 'zotero-library' }])

    const risActions = fileMenu.resolve({ sessionId: 's2', path: '/path/to/refs.ris' }, signal)
    expect(risActions).toHaveLength(1)
    expect(risActions[0].id).toBe('openInLibrary')
  })

  it('opens the captured session in the desktop app and reports a failed launch', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const itemMenu = world.contextMenuRegistrations.find(
      (reg) => reg.id === 'dsh-zotero.item.open',
    )!
    const signal = new AbortController().signal
    const actions = itemMenu.resolve(
      {
        ref: 'zotero://user/0/item/ABC12345',
        title: 'A sample paper',
        itemType: 'journalArticle',
      },
      signal,
    )

    expect(actions).toHaveLength(1)
    expect(actions[0].id).toBe('openInDesktop')
    expect(actions[0].icon).toEqual({ key: 'zotero.library' })

    await actions[0].run()
    expect(world.openProtocolCalls).toEqual(['zotero://select/library/items/ABC12345'])

    failOpenProtocol(world)
    await expect(actions[0].run()).resolves.toBeUndefined()
    expect(world.openProtocolCalls).toEqual([
      'zotero://select/library/items/ABC12345',
      'zotero://select/library/items/ABC12345',
    ])
  })

  it('copies the canonical select link and reports clipboard refusal', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const itemMenu = world.contextMenuRegistrations.find(
      (reg) => reg.id === 'dsh-zotero.item.copy',
    )!
    const signal = new AbortController().signal
    const actions = itemMenu.resolve(
      {
        ref: 'zotero://user/0/item/ABC12345',
        title: 'A sample paper',
        itemType: 'journalArticle',
      },
      signal,
    )
    const copyAction = actions.find((action: { id: string }) => action.id === 'copySelectLink')!

    await copyAction.run()
    expect(writeClipboard).toHaveBeenCalledWith('zotero://select/library/items/ABC12345')
    expect(world.notifications).toEqual([{ text: 'copied', success: true }])

    writeClipboard.mockResolvedValueOnce(false)
    world.notifications.length = 0
    await copyAction.run()
    expect(world.notifications).toEqual([
      { text: 'libraryCopyClipboardUnavailable', success: false },
    ])
  })
})
