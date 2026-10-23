/**
 * Browser-half entry: the apply wiring registers the page dictionaries, reads
 * the zotero namespace through the shared configuration form, injects the
 * configuration page into the `plugins.bundle.config` slot on the plugins
 * manager detail page, and mounts the zotero Typert Remote namespace for the
 * conversation tab's live status, gating that tab on the namespace's
 * `webEnabled` flag.
 * @module tests/client/apply
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'
import {
  SCHOLARLY_SETTINGS_NAMESPACE,
  ZOTERO_SETTINGS_NAMESPACE,
} from '../../src/settings-namespace.ts'
import { getAttachmentResolver } from '../../src/client/actions/attachment-resolver.ts'
import { REGISTRATIONS } from '../../src/client/toolviews/index.ts'
import { fakeScope } from './helpers/fake-scope.ts'
import { fakeEntryErrorSeam, type EntryErrorListener } from './helpers/slot-crash-seam.ts'

// The page imports primitive icons; stub them with the shared DOM face so
// this wiring-level spec does not load the real bundle (katex css, shiki, …).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

interface FakeSlotsEntry {
  name: string
  options: Record<string, unknown>
  component: unknown
}

interface FakeInjectedEntry {
  name: string
  register: () => FakeSlotsEntry | undefined
  /** False once the disposer the inject call returned has run (withdrawn). */
  active: boolean
}

interface FakeApplyWorld {
  ctx: unknown
  dictionaries: Array<{ ns: string; dict: unknown }>
  injected: Array<FakeInjectedEntry>
  registered: FakeSlotsEntry[]
  mounts: unknown[]
  effects: Array<unknown>
  mountDisposes: number
  injectDisposes: number
  formIds: string[]
  scope: ReturnType<typeof fakeScope>
  /** Scripted namespace `status` result; defaults to ok. */
  status: () => Promise<unknown>
  resolveAttachment: (ref: string) => Promise<unknown>
  /** Dependency lists each `ctx.inject` call declared, in call order. */
  injectDeps: string[][]
  /** Fibers disposed through the entry's disposer. */
  uiDisposes: number
  /** Conversation Node definitions registered through `uiConversation.events`. */
  eventDefinitions: Array<{ kind: string }>
  /** Disposers run for those definitions. */
  eventDisposes: number
  /** Every address the `sidebarRight` service was asked to open. */
  openResourceCalls: string[]
  /** Supervision listeners the entry registered through `slots.onEntryError`. */
  entryErrorListeners: EntryErrorListener[]
  /** Namespaces currently served by the host; defaults to both zotero and scholarly. */
  servedNamespaces?: Set<string>
  whileServedRegistrations: Array<{ namespaces: readonly string[] }>
  whileServedDisposes: number
}

/** A minimal context standing in for the browser kernel's plugin ctx. */
function fakeWorld(mountRejects: unknown = undefined): FakeApplyWorld {
  const dictionaries: FakeApplyWorld['dictionaries'] = []
  const injected: FakeInjectedEntry[] = []
  const registered: FakeApplyWorld['registered'] = []
  const mounts: FakeApplyWorld['mounts'] = []
  const effects: FakeApplyWorld['effects'] = []
  const formIds: string[] = []
  const seam = fakeEntryErrorSeam()
  const entryErrorListeners: EntryErrorListener[] = seam.listeners
  const scope = fakeScope()
  const whileServedRegistrations: FakeApplyWorld['whileServedRegistrations'] = []
  // The world object is shared with the ctx closures (disposer counters
  // included), so the returned handle observes the disposers' side effects.
  const world: FakeApplyWorld = {
    ctx: undefined,
    dictionaries,
    injected,
    registered,
    mounts,
    effects,
    mountDisposes: 0,
    injectDisposes: 0,
    formIds,
    scope,
    status: async () => ({ ok: true, value: { connected: true } }),
    resolveAttachment: async (ref: string) => ({ ok: true, value: { ref, kind: 'file' } }),
    injectDeps: [],
    uiDisposes: 0,
    eventDefinitions: [],
    eventDisposes: 0,
    openResourceCalls: [],
    entryErrorListeners,
    whileServedRegistrations,
    whileServedDisposes: 0,
  }
  // Effects registered while a fiber's callback runs belong to that fiber, so
  // disposing the fiber unwinds exactly what it registered: the same
  // ownership cordis gives `ctx.effect`.
  let collector: Array<() => void> | undefined
  const ctx = {
    effect: (register: () => unknown): (() => void) => {
      const dispose = register()
      const disposer = typeof dispose === 'function' ? (dispose as () => void) : () => {}
      effects.push(dispose)
      collector?.push(disposer)
      return disposer
    },
    locale: {
      register: (ns: string, dict: unknown) => {
        dictionaries.push({ ns, dict })
      },
      bind: () => (key: string) => key,
    },
    remote: {
      $mount: async (contribution: unknown) => {
        mounts.push(contribution)
        if (mountRejects !== undefined) throw mountRejects
        return () => {
          world.mountDisposes += 1
        }
      },
      /**
       * The namespace `$mount` publishes. It is readable through the dotted
       * form only on a fiber that declared `remote.zotero`, so the UI callback
       * reads it here exactly as the runtime writes it.
       */
      zotero: {
        status: () => world.status(),
        resolveAttachment: (ref: string) => world.resolveAttachment(ref),
        diagnostics: async () =>
          ({
            ok: true as const,
            value: { entries: [], total: 0, truncated: false, debug: false },
          }) as unknown,
        reportClientError: async (report: { surface: string; message: string }) =>
          ({ ok: true as const, value: { seq: 1, report } }) as unknown,
      },
    },
    /**
     * Start a fiber for `deps`, run its callback, and hand back the disposer
     * that unwinds the effects it registered: the shape
     * `vendor/cordis/src/registry.ts` gives `ctx.inject`.
     */
    inject: (deps: readonly string[], callback: (ctx: unknown) => void) => {
      world.injectDeps.push([...deps])
      const owned: Array<() => void> = []
      collector = owned
      try {
        callback(ctx)
      } finally {
        collector = undefined
      }
      const dispose = async () => {
        for (const disposer of owned.reverse()) disposer()
        world.uiDisposes += 1
      }
      return Object.assign(Promise.resolve({ dispose }), { dispose })
    },
    configForms: {
      get: (id: string) => {
        formIds.push(id)
        return world.scope
      },
      whileServed: (
        namespaces: readonly string[],
        register: (served: ReadonlySet<string>) => () => void,
      ) => {
        world.whileServedRegistrations.push({ namespaces })
        const served =
          world.servedNamespaces ??
          new Set([ZOTERO_SETTINGS_NAMESPACE, SCHOLARLY_SETTINGS_NAMESPACE])
        if (!namespaces.some((ns) => served.has(ns))) return () => {}
        const disposer = register(served)
        return () => {
          world.whileServedDisposes += 1
          disposer?.()
        }
      },
    },
    uiConversation: {
      events: {
        register: (definition: { kind: string }) => {
          world.eventDefinitions.push(definition)
          return () => {
            world.eventDisposes += 1
          }
        },
      },
    },
    sidebarRight: {
      openResource: (url: string) => {
        world.openResourceCalls.push(url)
      },
    },
    slots: {
      inject: (name: string, register: () => unknown) => {
        const entry: FakeInjectedEntry = {
          name,
          register: () => {
            const res = register()
            if (res && typeof res === 'object' && Symbol.iterator in res) {
              const list = [...(res as Iterable<FakeSlotsEntry>)]
              return list[0]
            }
            return res as FakeSlotsEntry | undefined
          },
          active: true,
        }
        injected.push(entry)
        return () => {
          entry.active = false
          world.injectDisposes += 1
        }
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        // The renderer stamps `options.registrant ?? ctx.fiber?.name` onto the
        // stored entry; the plugin declares it explicitly, so the stored shape
        // here reproduces that stamp rather than the raw options.
        const item = {
          name: String(options.name),
          options,
          component,
          registrant: (options.registrant as string | undefined) ?? 'dsh-zotero',
        }
        registered.push(item)
        return item
      },
      // The crash supervision seam: the entry subscribes here, and a spec can
      // fire it to drive the intake without mounting a crashing entry.
      onEntryError: seam.onEntryError,
    },
  }
  world.ctx = ctx
  return world
}

/**
 * Run the entry and settle it the way the kernel does: the mount resolves and
 * the UI fiber loads, so the returned disposer owns both halves.
 * @param world - the world to apply the entry to.
 * @returns the entry's disposer.
 */
async function applyEntry(world: FakeApplyWorld): Promise<() => Promise<void>> {
  return await apply(world.ctx as Context)
}

describe('the browser-half entry', () => {
  it('declares the services it consumes', () => {
    expect(inject).toEqual([
      'locale',
      'slots',
      'remote',
      'configForms',
      'uiConversation',
      'sidebarRight',
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
    expect(world.formIds).toEqual([ZOTERO_SETTINGS_NAMESPACE, SCHOLARLY_SETTINGS_NAMESPACE])
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
    // bundle config page, the scholarly row config, the plugin-manager cards,
    // and the conversation tab (whose registration must not wait on the Remote mount).
    expect(world.injected.map((entry) => entry.name)).toEqual([
      'tool.call.toolview',
      'conversation.chat.node',
      'plugins.bundle.activation',
      'plugins.bundle.config',
      'plugins.row.config',
      'plugins.detail.section',
      'plugins.detail.section',
      'conversation.chat.commandview',
      'conversation.view',
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

  it('guards scholarly row config with whileServed so it registers only when served', async () => {
    const worldServed = fakeWorld()
    await applyEntry(worldServed)
    expect(worldServed.whileServedRegistrations).toEqual([
      { namespaces: [SCHOLARLY_SETTINGS_NAMESPACE] },
    ])
    const rowEntry = worldServed.injected.find((e) => e.name === 'plugins.row.config')
    expect(rowEntry?.register()).toBeDefined()
    const config = worldServed.registered.find((e) => e.name === 'plugins.row.config')
    expect(config?.options.key).toBe('dsh-zotero#scholarly')
    expect(config?.options.locale).toBe('zotero')
    const face = (config?.options.inject as () => { hooks: { scholarlyCard: unknown } })()
    expect(face.hooks.scholarlyCard).toBeDefined()

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
      ['remote.zotero', 'locale', 'slots', 'configForms', 'uiConversation', 'sidebarRight'],
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

  it('skips the tab when the namespace disables webEnabled', async () => {
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
      'plugins.detail.section',
      'plugins.detail.section',
      'conversation.chat.commandview',
    ])
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

  it('withdraws the tab live when webEnabled turns off and restores it on', async () => {
    const world = fakeWorld()
    await applyEntry(world)
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // Toggle the flag: the gate subscription withdraws the tab. The fake scope
    // publishes its listeners synchronously inside the write, so the awaited
    // write is the whole wait: the tab is withdrawn by the time it resolves.
    await world.scope.set('webEnabled', false)
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
    expect(world.injectDisposes).toBe(1)

    // Toggle back on: the tab returns (a fresh live registration).
    await world.scope.set('webEnabled', true)
    expect(
      world.injected
        .filter((entry) => entry.name === 'conversation.view')
        .some((entry) => entry.active),
    ).toBe(true)
  })

  it('withdraws the tab with the fiber and unmounts the Remote', async () => {
    const world = fakeWorld()
    const dispose = await applyEntry(world)
    expect(world.scope.unsubscribes).toBe(0)
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // The entry's disposer unwinds the UI fiber, which owns every effect and
    // slot registration it made: the projection's definition, the card form's
    // subscription, the tab gate's subscription, the tab itself, and then the
    // mount.
    await dispose()
    expect(world.eventDisposes).toBe(1)
    expect(world.scope.unsubscribes).toBe(3)
    expect(world.uiDisposes).toBe(1)
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
    expect(world.mountDisposes).toBe(1)
  })

  it('injects a page face whose scope reads the namespace snapshot', async () => {
    const world = fakeWorld()
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
})
