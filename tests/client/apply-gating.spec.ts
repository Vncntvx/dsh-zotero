/**
 * The browser-half entry's `webEnabled` gating: which surfaces the flag hides
 * or restores live, the registration shape it controls, and the library
 * surface's withdrawal shape. The wiring seams these tests share live in
 * `helpers/apply-world.ts`.
 * @module tests/client/apply-gating
 */

import { describe, expect, it, vi } from 'vitest'
import { applyEntry, fakeWorld } from './helpers/apply-world.ts'
import { fakeScope } from './helpers/fake-scope.ts'

// The page imports primitive icons; stub them with the shared DOM face so
// this wiring-level spec does not load the real bundle (katex css, shiki, …).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

describe('the browser-half entry behind the webEnabled gate', () => {
  it('registers the Zotero conversation tab while webEnabled is not off', async () => {
    const world = fakeWorld()
    const statusSpy = vi.fn(async () => ({ ok: true, value: {} }))
    world.status = statusSpy
    await applyEntry(world)
    const tab = world.injected.find((entry) => entry.name === 'conversation.view')
    expect(tab).toBeDefined()
    tab?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    expect(registration?.options.id).toBe('zotero')
    expect(registration?.options.order).toBe(30)
    expect(registration?.options.locale).toBe('zotero')
    expect((registration?.options.label as () => string)()).toBe('nav')
    // The ownership stamp the crash intake filters on: declared explicitly
    // rather than inherited from the fiber name, so a harness-side rename
    // cannot silently move which crashes the intake claims.
    expect(registration?.options.registrant).toBe('dsh-zotero')
    const face = registration?.options.inject as () => {
      status: () => Promise<unknown>
    }
    const faceObj = face()
    expect(faceObj.status).toBeTypeOf('function')
    await faceObj.status()
    expect(statusSpy).toHaveBeenCalled()
  })

  it('registers the tab while the namespace is loading or unavailable', async () => {
    for (const status of ['loading', 'unavailable'] as const) {
      const world = fakeWorld()
      world.scope = fakeScope({ status })
      await applyEntry(world)
      expect(
        world.injected.some((entry) => entry.name === 'conversation.view'),
        `tab on ${status}`,
      ).toBe(true)
    }
  })

  it('skips the gated surfaces when the namespace disables webEnabled', async () => {
    const world = fakeWorld()
    world.scope = fakeScope({
      value: { webEnabled: false },
      user: { webEnabled: false },
    })
    await applyEntry(world)
    expect(world.injected.map((entry) => entry.name)).toEqual([
      'tool.call.toolview',
      'conversation.chat.node',
      'plugins.bundle.activation',
      'plugins.bundle.config',
      'plugins.row.config',
      'plugins.row.config',
      'plugins.detail.section',
      'plugins.detail.section',
      'conversation.chat.commandview',
    ])
  })

  it('withdraws the tab live when webEnabled turns off and restores it on', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // Toggle the flag: the gate subscription withdraws the tab. The fake scope
    // publishes its listeners synchronously inside the write, so the awaited
    // write is the whole wait: the tab is withdrawn by the time it resolves.
    await world.scope.set('webEnabled', false)
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
    expect(world.injected.find((entry) => entry.name === 'sidebar.right.pane.tab')?.active).toBe(
      false,
    )
    expect(
      world.injected.find((entry) => entry.name === 'sidebar.right.pane.tab.title')?.active,
    ).toBe(false)
    expect(world.injectDisposes).toBe(3)

    // Toggle back on: the tab returns (a fresh live registration).
    await world.scope.set('webEnabled', true)
    expect(world.injected.filter((e) => e.name === 'conversation.view').some((e) => e.active)).toBe(
      true,
    )
  })

  it('toggles the library surface through library config', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    expect(world.injected.find((e) => e.name === 'sidebar.right.pane.tab')?.active).toBe(true)

    // Disable right sidebar
    await world.libraryScope.set('rightSidebarEnabled', false)
    expect(world.injected.find((e) => e.name === 'sidebar.right.pane.tab')?.active).toBe(false)
    expect(world.injected.find((e) => e.name === 'sidebar.right.pane.tab.title')?.active).toBe(
      false,
    )
    expect(world.sidebarRightTabDisposes).toBe(1)

    // Re-enable right sidebar
    await world.libraryScope.set('rightSidebarEnabled', true)
    expect(
      world.injected.filter((e) => e.name === 'sidebar.right.pane.tab').some((e) => e.active),
    ).toBe(true)
  })

  it('ignores the sidebar toggle when it rides the zotero namespace', async () => {
    // Namespace regression fence: the toggle lives in the `library` section,
    // so writing it through the `zotero` form must move nothing. The first
    // broken wiring read both forms from one scope and passed every toggle
    // test while the real client listened to a namespace no host serves.
    const world = fakeWorld()
    await applyEntry(world)
    await world.scope.set('rightSidebarEnabled', false)
    expect(world.injected.find((e) => e.name === 'sidebar.right.pane.tab')?.active).toBe(true)
  })

  it('registers no library surface while the library namespace is not served', async () => {
    const world = fakeWorld()
    world.servedNamespaces = new Set(['zotero', 'scholarly'])
    await applyEntry(world)
    const librarySurfaces = ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']
    for (const name of librarySurfaces) {
      expect(
        world.injected.find((e) => e.name === name),
        name,
      ).toBeUndefined()
    }
    expect(world.sidebarRightTabDefinitions).toEqual([])

    // The row coming back restores every surface in one group.
    world.servedNamespaces?.add('library')
    // Re-apply: the whileServed watch is re-armed by a fresh apply, the same
    // way a reload re-runs it after the row is enabled.
    await applyEntry(world)
    expect(world.injected.find((e) => e.name === 'sidebar.right.pane.tab')?.active).toBe(true)
  })
})
