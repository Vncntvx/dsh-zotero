/**
 * Browser-half entry: the apply wiring registers the page dictionaries, reads
 * the zotero namespace through the shared configuration form, injects the
 * configuration page into the `plugins.bundle.config` slot on the plugins
 * manager detail page, and mounts the zotero Typert Remote namespace for the
 * conversation tab's live status. The `webEnabled` gate's own behavior lives
 * in `apply-gating.spec.ts`; both share `helpers/apply-world.ts`.
 * @module tests/client/apply
 */

import { describe, expect, it, vi } from 'vitest'
import { inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'
import {
  SCHOLARLY_SETTINGS_NAMESPACE,
  ZOTERO_SETTINGS_NAMESPACE,
} from '../../src/settings-namespace.ts'
import { ZOTERO_LIBRARY_SETTINGS_NAMESPACE } from '../../src/contract.ts'
import { getAttachmentResolver } from '../../src/client/actions/attachment-resolver.ts'
import { REGISTRATIONS } from '../../src/client/toolviews/index.ts'
import { applyEntry, fakeWorld, type FakeApplyWorld } from './helpers/apply-world.ts'
import { fakeScope } from './helpers/fake-scope.ts'
import type { ZoteroLibraryPanelFace } from '../../src/client/components/library/ZoteroLibraryPanel.tsx'
import { searchResult } from '../helpers/library-fixtures.ts'

// The page imports primitive icons; stub them with the shared DOM face so
// this wiring-level spec does not load the real bundle (katex css, shiki, …).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

describe('the browser-half entry', () => {
  it('declares the services it consumes', () => {
    expect(inject).toEqual([
      'locale',
      'slots',
      'remote',
      'configForms',
      'uiConversation',
      'sidebarRight',
      'sidebarRightTabs',
    ])
  })

  it('registers the page dictionaries on apply', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.dictionaries).toEqual([{ ns: 'zotero', dict: { zh, en } }])
  })

  it('registers the zotero command-input projection and its chat node renderer', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.eventDefinitions.map((definition) => definition.kind)).toEqual([
      'zotero-command-input',
    ])
    const entry = world.injected.find((item) => item.name === 'conversation.chat.node')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()
    const registration = world.registered.find((item) => item.name === 'conversation.chat.node')
    expect(registration?.options.key).toBe('zotero-command-input')
    expect(registration?.options.locale).toBe('zotero')
    expect(typeof registration?.component).toBe('function')
  })

  it('reads the shared form for the shared namespace constant', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.formIds).toEqual([
      ZOTERO_SETTINGS_NAMESPACE,
      SCHOLARLY_SETTINGS_NAMESPACE,
      ZOTERO_LIBRARY_SETTINGS_NAMESPACE,
    ])
  })

  it('mounts the zotero Remote namespace contribution', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.mounts).toHaveLength(1)
    const contribution = world.mounts[0] as { package: string }
    expect(contribution.package).toBe('dsh-zotero')
  })

  it('registers all plugin surfaces synchronously on apply', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    // All surfaces register synchronously: the command-input projection, the
    // bundle config page, the row configs, the plugin-manager cards,
    // the conversation tab, and the right-sidebar library surfaces.
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
      'conversation.view',
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab.title',
    ])
  })

  it('injects the activation guide into the plugins.bundle.activation slot', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const entry = world.injected.find((e) => e.name === 'plugins.bundle.activation')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const guide = world.registered.find((e) => e.name === 'plugins.bundle.activation')
    expect(guide?.options.key).toBe('dsh-zotero')
    expect(guide?.options.locale).toBe('zotero')
    expect(typeof guide?.component).toBe('function')
    const guideInject = (guide?.options.inject as () => { probe: () => Promise<unknown> })()
    expect(typeof guideInject.probe).toBe('function')
  })

  it('deduplicates concurrent in-flight probe calls sharing the same remote request', async () => {
    const world = fakeWorld()
    let statusCallCount = 0
    let resolveStatus!: (res: unknown) => void
    world.status = () =>
      new Promise((resolve) => {
        statusCallCount += 1
        resolveStatus = resolve
      })
    await applyEntry(world)

    const guideEntry = world.injected.find((e) => e.name === 'plugins.bundle.activation')
    guideEntry?.register()
    const guide = world.registered.find((e) => e.name === 'plugins.bundle.activation')
    const guideInject = (
      guide?.options.inject as () => { probe: () => Promise<unknown>; t: unknown }
    )()

    const task1 = guideInject.probe()
    const task2 = guideInject.probe()

    expect(task1).toBe(task2)
    expect(statusCallCount).toBe(1)

    resolveStatus({ ok: true, value: { connected: true } })
    await Promise.all([task1, task2])

    const task3 = guideInject.probe()
    expect(task3).not.toBe(task1)
    expect(statusCallCount).toBe(2)
    resolveStatus({ ok: true, value: { connected: true } })
    await task3
  })

  it('injects the bundle configuration page into the plugins.bundle.config slot', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const entry = world.injected.find((e) => e.name === 'plugins.bundle.config')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const config = world.registered.find((e) => e.name === 'plugins.bundle.config')
    expect(config?.options.key).toBe('dsh-zotero')
    expect(config?.options.locale).toBe('zotero')
    expect(typeof config?.component).toBe('function')
    const configInject = (
      config?.options.inject as () => {
        hooks: { zoteroCard: unknown }
      }
    )()
    expect(configInject.hooks.zoteroCard).toBeDefined()
  })

  it('guards scholarly and library row configs with whileServed so they register only when served', async () => {
    const worldServed = fakeWorld()
    await applyEntry(worldServed)
    expect(worldServed.whileServedRegistrations).toEqual([
      { namespaces: [SCHOLARLY_SETTINGS_NAMESPACE] },
      { namespaces: [ZOTERO_LIBRARY_SETTINGS_NAMESPACE] },
      // The panel gate: the library surfaces follow the same served watch.
      { namespaces: [ZOTERO_LIBRARY_SETTINGS_NAMESPACE] },
    ])
    const rowEntries = worldServed.injected.filter((e) => e.name === 'plugins.row.config')
    expect(rowEntries).toHaveLength(2)
    for (const entry of rowEntries) entry.register()

    const scholarlyConfig = worldServed.registered.find(
      (e) => e.name === 'plugins.row.config' && e.options.key === 'dsh-zotero#scholarly',
    )
    expect(scholarlyConfig).toBeDefined()
    expect(scholarlyConfig?.options.locale).toBe('zotero')
    const scholarlyFace = (
      scholarlyConfig?.options.inject as () => { hooks: { scholarlyCard: unknown } }
    )()
    expect(scholarlyFace.hooks.scholarlyCard).toBeDefined()

    const libraryConfig = worldServed.registered.find(
      (e) => e.name === 'plugins.row.config' && e.options.key === 'dsh-zotero#library',
    )
    expect(libraryConfig).toBeDefined()
    expect(libraryConfig?.options.locale).toBe('zotero')
    const libraryFace = (
      libraryConfig?.options.inject as () => { hooks: { libraryCard: unknown } }
    )()
    expect(libraryFace.hooks.libraryCard).toBeDefined()

    const worldUnserved = fakeWorld()
    worldUnserved.servedNamespaces = new Set([ZOTERO_SETTINGS_NAMESPACE])
    await applyEntry(worldUnserved)
    expect(worldUnserved.injected.some((e) => e.name === 'plugins.row.config')).toBe(false)
  })

  it('injects the detail section into the plugins.detail.section slot', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const entry = world.injected.find((e) => e.name === 'plugins.detail.section')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const section = world.registered.find((e) => e.name === 'plugins.detail.section')
    expect(section?.options.id).toBe('zotero-status')
    expect(section?.options.locale).toBe('zotero')
    expect(typeof section?.component).toBe('function')
    const sectionInject = (section?.options.inject as () => { probe: () => Promise<unknown> })()
    expect(typeof sectionInject.probe).toBe('function')
  })

  it('injects the diagnostics card as the second plugins.detail.section entry', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    for (const entry of world.injected.filter((e) => e.name === 'plugins.detail.section')) {
      entry.register()
    }
    const sections = world.registered.filter((e) => e.name === 'plugins.detail.section')
    expect(sections).toHaveLength(2)
    const diagnostics = sections.find((e) => e.options.id === 'zotero-diagnostics')
    expect(diagnostics).toBeDefined()
    expect(diagnostics?.options.locale).toBe('zotero')
    const face = (
      diagnostics?.options.inject as () => {
        probe: () => Promise<unknown>
        diagnostics: () => Promise<unknown>
      }
    )()
    expect(typeof face.diagnostics).toBe('function')
    await face.diagnostics()
    expect(typeof face.probe).toBe('function')
  })

  it('injects and registers the zotero command card into the conversation.chat.commandview slot', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const entry = world.injected.find((e) => e.name === 'conversation.chat.commandview')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const card = world.registered.find((e) => e.name === 'conversation.chat.commandview')
    expect(card?.options.key).toBe('zotero')
    expect(card?.options.locale).toBe('zotero')
    expect(typeof card?.component).toBe('function')
    const cardInject = (card?.options.inject as () => { probe: () => Promise<unknown> })()
    expect(typeof cardInject.probe).toBe('function')
  })

  it('rejects instead of degrading when the mount rejects', async () => {
    const world = fakeWorld(new Error('gateway offline'))
    // An assembly mistake is not swallowed: the entry rejects, so the harness
    // reports the plugin as failed to load instead of leaving a status strip
    // that can never answer (`docs/cookbook/adding-a-remote-api.md`).
    await expect(applyEntry(world)).rejects.toThrow('gateway offline')
    // The UI fiber is never started (it sits behind the mount), so nothing is
    // registered and nothing needs withdrawing.
    expect(world.injectDeps).toEqual([])
    expect(world.injected).toEqual([])
    expect(world.mountDisposes).toBe(0)
  })

  it('propagates a non-Error mount rejection instead of dropping it', async () => {
    const world = fakeWorld('gateway exploded')
    await expect(applyEntry(world)).rejects.toBe('gateway exploded')
    expect(world.injectDeps).toEqual([])
    expect(world.injected).toEqual([])
  })

  it('reads the namespace through the official dotted form on the UI fiber', async () => {
    const world = fakeWorld()
    const dispose = await applyEntry(world)
    // The UI fiber declared `remote.zotero`, so `ctx.remote.zotero` is a legal
    // service read there: the same shape the harness's own client plugins use.
    expect(world.injectDeps).toEqual([
      [
        'remote.zotero',
        'locale',
        'slots',
        'configForms',
        'uiConversation',
        'sidebarRight',
        'sidebarRightTabs',
      ],
    ])
    const tab = world.injected.find((entry) => entry.name === 'conversation.view')
    tab?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    const face = (registration?.options.inject as () => { status: () => Promise<unknown> })()
    await expect(face.status()).resolves.toEqual({
      ok: true,
      value: { connected: true },
    })
    await dispose()
  })

  it('disposes the UI fiber and unmounts the Remote, in that order', async () => {
    const world = fakeWorld()
    const dispose = await applyEntry(world)
    expect(world.mountDisposes).toBe(0)
    expect(world.uiDisposes).toBe(0)
    await dispose()
    expect(world.mountDisposes).toBe(1)
    expect(world.uiDisposes).toBe(1)
    // The UI fiber withdraws its registrations before the namespace goes, so
    // no surface is left reading a namespace that has been unmounted.
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
  })

  it('subscribes to the slot crash intake on the fiber and withdraws it', async () => {
    const world = fakeWorld()
    const dispose = await applyEntry(world)
    // One listener, registered through the registry's own supervision seam
    // rather than from a render boundary: the entry is what wires the intake.
    expect(world.entryErrorListeners).toHaveLength(1)
    await dispose()
    expect(world.entryErrorListeners).toHaveLength(0)
  })

  it('opens the resource address the tab hands it, verbatim', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    const tab = world.injected.find((entry) => entry.name === 'conversation.view')
    tab?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    const face = registration?.options.inject as () => {
      openResource: (url: string) => void
      resolveAttachment: (ref: string) => Promise<unknown>
      status: () => Promise<unknown>
    }
    // The tab owns the Session identity and the workspace root, so it builds
    // the whole session-scoped address itself (through `useSessions` +
    // `fileAddressFor`) and hands the face a ready URL. The face only opens it:
    // this fiber cannot resolve a cwd, because on the browser side the
    // `ctx.sessions` Context key carries the host `SessionStore`, not the
    // client `ISessions` catalog.
    face().openResource('dsh-resource://file/session/sess-1/storage/paper.pdf')
    expect(world.openResourceCalls).toEqual([
      'dsh-resource://file/session/sess-1/storage/paper.pdf',
    ])
    await face().resolveAttachment('item-123')
    await face().status()
    await getAttachmentResolver()?.('item-123')
  })

  it('passes the address through without reading any session state', async () => {
    const world = fakeWorld()
    // The fake world carries no session catalog at all: the fiber does not
    // declare `sessions`, so a face that consulted one would find nothing and
    // could not resolve a workspace root — its output would differ from the
    // input URL. Passing it through verbatim is the whole contract.
    await applyEntry(world)
    const tab = world.injected.find((entry) => entry.name === 'conversation.view')
    tab?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    const face = registration?.options.inject as () => {
      openResource: (url: string) => void
    }
    face().openResource('dsh-resource://file/session/sess-9/notes/a.md')
    expect(world.openResourceCalls).toEqual(['dsh-resource://file/session/sess-9/notes/a.md'])
  })

  it('injects and registers all tool views into the tool.call.toolview slot', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    const entry = world.injected.find((item) => item.name === 'tool.call.toolview')
    expect(entry).toBeDefined()
    entry?.register()

    const toolRegistrations = world.registered.filter((item) => item.name === 'tool.call.toolview')
    expect(toolRegistrations.map((item) => item.options.key)).toEqual(
      REGISTRATIONS.map(([name]) => name),
    )
    for (const reg of toolRegistrations) {
      expect(reg.options.locale).toBe('zotero')
      expect(typeof reg.component).toBe('function')
    }
  })

  it('withdraws the tab with the fiber and unmounts the Remote', async () => {
    const world = fakeWorld()
    const dispose = await applyEntry(world)
    expect(world.scope.unsubscribes).toBe(0)
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // The disposer unwinds the UI fiber: the projection, the card forms'
    // subscriptions, the gated surfaces subscriptions, and the mount.
    // Per-namespace counts: the zotero form carries the webEnabled watch, the
    // card model, and the panel gate's sync; the library form carries its own
    // sync and card model; the scholarly form its card model.
    await dispose()
    expect(world.eventDisposes).toBe(1)
    expect(world.scope.unsubscribes).toBe(3)
    expect(world.libraryScope.unsubscribes).toBe(2)
    expect(world.scholarlyScope.unsubscribes).toBe(1)
    expect(world.uiDisposes).toBe(1)
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
    expect(world.mountDisposes).toBe(1)
  })

  it('registers the right-sidebar library surfaces', async () => {
    const world = fakeWorld()
    await applyEntry(world)

    // Right sidebar surfaces
    expect(world.sidebarRightTabDefinitions).toHaveLength(1)
    const rightTabDef = world.sidebarRightTabDefinitions[0] as { id: string; kind: string }
    expect(rightTabDef.id).toBe('dsh-zotero#library')
    expect(rightTabDef.kind).toBe('zotero-library')

    const rightTabEntry = world.injected.find((e) => e.name === 'sidebar.right.pane.tab')
    expect(rightTabEntry).toBeDefined()
    rightTabEntry?.register()
    const rightTabReg = world.registered.find((e) => e.name === 'sidebar.right.pane.tab')
    expect(rightTabReg?.options.key).toBe('dsh-zotero#library')

    const rightTitleEntry = world.injected.find((e) => e.name === 'sidebar.right.pane.tab.title')
    expect(rightTitleEntry).toBeDefined()
    rightTitleEntry?.register()
    const rightTitleReg = world.registered.find((e) => e.name === 'sidebar.right.pane.tab.title')
    expect(rightTitleReg?.options.key).toBe('dsh-zotero#library')
  })

  it('wires panel invalidation through the shared reads to the host search generation', async () => {
    const world = fakeWorld()
    const search = vi.fn(async () => ({ ok: true, value: searchResult() }))
    const ctx = world.ctx as { remote: { zotero: Record<string, unknown> } }
    ctx.remote.zotero.search = search
    await applyEntry(world)
    world.injected.find((entry) => entry.name === 'sidebar.right.pane.tab')?.register()
    const registration = world.registered.find((entry) => entry.name === 'sidebar.right.pane.tab')
    const face = (registration?.options.inject as () => ZoteroLibraryPanelFace)()
    const query = {
      scope: { kind: 'library' as const },
      sort: 'title' as const,
      direction: 'asc' as const,
      offset: 0,
      limit: 50,
      yearFrom: 2020,
    }
    await face.search(query)
    await face.search(query)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenLastCalledWith({ ...query, cacheGeneration: 0 })
    face.invalidate?.()
    await face.search(query)
    expect(search).toHaveBeenCalledTimes(2)
    expect(search).toHaveBeenLastCalledWith({ ...query, cacheGeneration: 1 })
  })

  it('wires every panel face member through the plane to the host namespace', async () => {
    const world = fakeWorld()
    const wire = world.libraryWire
    const browse = vi.spyOn(wire, 'browse')
    const item = vi.spyOn(wire, 'item')
    const childPage = vi.spyOn(wire, 'childPage')
    const write = vi.spyOn(wire, 'write')
    const resolveAttachment = vi.spyOn(world, 'resolveAttachment')
    const status = vi.spyOn(world, 'status')
    // The panel's export read goes through the plane too, so its wire method
    // is scripted on the namespace the fake world publishes.
    const remote = (world.ctx as { remote: { zotero: Record<string, unknown> } }).remote
    const exportSpy = vi.fn(async () => ({
      ok: true as const,
      value: { format: 'citation' as const, citations: [] },
    }))
    remote.zotero.export = exportSpy
    await applyEntry(world)
    world.injected.find((entry) => entry.name === 'sidebar.right.pane.tab')?.register()
    const registration = world.registered.find((entry) => entry.name === 'sidebar.right.pane.tab')
    const face = (registration?.options.inject as () => ZoteroLibraryPanelFace)()

    const browseRequest = { kind: 'libraries' as const, offset: 0, limit: 50 }
    await face.browse(browseRequest)
    expect(browse).toHaveBeenCalledWith(browseRequest)
    const itemRequest = { ref: 'zotero://user/0/item/ABCD1234', include: [], childPages: {} }
    await face.item(itemRequest)
    expect(item).toHaveBeenCalledWith(itemRequest)
    const childPageRequest = {
      ref: 'zotero://user/0/item/ABCD1234',
      kind: 'notes' as const,
      offset: 0,
      limit: 50,
    }
    await face.childPage(childPageRequest)
    expect(childPage).toHaveBeenCalledWith(childPageRequest)
    const exportRequest = {
      refs: ['zotero://user/0/item/ABCD1234'],
      format: 'citation' as const,
    }
    await face.export(exportRequest)
    expect(exportSpy).toHaveBeenCalledWith(exportRequest)
    // The second identical copy is answered by the plane's cache, not the wire.
    await face.export(exportRequest)
    expect(exportSpy).toHaveBeenCalledTimes(1)
    const writeRequest = {
      sessionId: 's1',
      operation: 'createCollection' as const,
      args: { name: 'New' },
    }
    await face.write(writeRequest)
    expect(write).toHaveBeenCalledWith(writeRequest)
    await face.resolveAttachment('zotero://user/0/item/ABCD1234')
    expect(resolveAttachment).toHaveBeenCalledWith('zotero://user/0/item/ABCD1234')
    await face.status()
    expect(status).toHaveBeenCalled()
    // The plane re-keys its cache to the confirmed instance.
    face.setInstance?.('S2')
    face.setInstance?.('S2')
    await face.browse(browseRequest)
    expect(browse).toHaveBeenCalledTimes(2)
    face.openResource('dsh-resource://file/session/s1//tmp/paper.pdf')
    expect(world.openResourceCalls.at(-1)).toBe('dsh-resource://file/session/s1//tmp/paper.pdf')
  })

  it('injects a page face whose scope reads the namespace snapshot', async () => {
    const world: FakeApplyWorld = fakeWorld()
    world.scope = fakeScope({
      value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 },
    })
    await applyEntry(world)
    const entry = world.injected.find((entry) => entry.name === 'plugins.bundle.config')
    expect(entry?.register()).toBeDefined()
    const registration = world.registered.find((entry) => entry.name === 'plugins.bundle.config')
    const injectFn = registration?.options.inject as () => {
      hooks: { zoteroCard: { getSnapshot: () => unknown } }
    }
    const face = injectFn()
    const state = face.hooks.zoteroCard.getSnapshot() as {
      available: boolean
      baseUrl: { text: string }
    }
    expect(state.available).toBe(true)
    expect(state.baseUrl.text).toBe('http://127.0.0.1:23119/api')
  })

  it('unwinds mount and ui if ui fiber setup rejects', async () => {
    const world = fakeWorld(undefined, new Error('inject failed'))
    await expect(applyEntry(world)).rejects.toThrow('inject failed')
    expect(world.uiDisposes).toBe(1)
    expect(world.mountDisposes).toBe(1)
  })
})
