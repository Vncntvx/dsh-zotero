/**
 * Browser-half entry: the apply wiring registers the page dictionaries, reads
 * the zotero namespace through the shared configuration form, injects the
 * configuration page into the `settings.section` slot (one left-nav entry in
 * the Settings panel), and mounts the zotero Typert Remote namespace for the
 * conversation tab's live status, gating that tab on the namespace's
 * `webEnabled` flag.
 * @module tests/client/apply
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'
import { ZOTERO_SETTINGS_NAMESPACE } from '../../src/settings-namespace.ts'
import { fakeScope } from './helpers/fake-scope.ts'

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
  /** How many times the entry read the namespace face through the service store. */
  reflectCalls: number
  /** Conversation Node definitions registered through `uiConversation.events`. */
  eventDefinitions: Array<{ kind: string }>
  /** Disposers run for those definitions. */
  eventDisposes: number
}

/** A minimal context standing in for the browser kernel's plugin ctx. */
function fakeWorld(mountFail = false, mountRejects: unknown = undefined): FakeApplyWorld {
  const dictionaries: FakeApplyWorld['dictionaries'] = []
  const injected: FakeInjectedEntry[] = []
  const registered: FakeApplyWorld['registered'] = []
  const mounts: FakeApplyWorld['mounts'] = []
  const effects: FakeApplyWorld['effects'] = []
  const formIds: string[] = []
  const scope = fakeScope()
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
    status: async () => ({ ok: true, value: { connected: true, diagnosis: 'ok' } }),
    reflectCalls: 0,
    eventDefinitions: [],
    eventDisposes: 0,
  }
  const ctx = {
    effect: (register: () => unknown): (() => void) => {
      effects.push(register())
      return () => {}
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
       * The dotted child read the store path replaced. Cordis answers it with
       * this guard on any fiber carrying a runtime
       * (`vendor/cordis/src/reflect.ts`), so the fixture throws exactly as the
       * runtime does: any code that reintroduces `ctx.remote.zotero` fails here
       * instead of silently killing the mount again.
       */
      get zotero(): never {
        throw new Error('cannot get property "remote.zotero" without inject')
      },
    },
    reflect: {
      get: () => {
        world.reflectCalls += 1
        return mountFail
          ? undefined
          : {
              status: world.status,
            }
      },
    },
    configForms: {
      get: (id: string) => {
        formIds.push(id)
        return world.scope
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
        const item = { name: String(options.name), options, component }
        registered.push(item)
        return item
      },
    },
  }
  world.ctx = ctx
  return world
}

/**
 * Await the Remote mount `apply` starts — the only asynchronous effect
 * (`src/client/index.ts`, `dsh-zotero: remote`; the others register
 * synchronously and are collected as their disposers). The promise settles
 * after the mount attempt, the namespace read through the service store, and
 * the fault log, so a test that awaits it reads `reflectCalls` and the mount
 * state as settled — nothing here waits for a duration.
 * @param world - the world `apply` was called on.
 * @returns the settled mount disposer.
 */
async function settleMount(world: FakeApplyWorld): Promise<() => void> {
  const mount = world.effects.find((entry): entry is Promise<unknown> => entry instanceof Promise)
  // A missing async effect would otherwise turn every await into a silent
  // no-op, so a rewiring of the effects fails here instead.
  if (mount === undefined) throw new Error('the Remote mount effect is not present')
  return (await mount) as () => void
}

describe('the browser-half entry', () => {
  it('declares the services it consumes', () => {
    expect(inject).toEqual(['locale', 'slots', 'remote', 'configForms', 'uiConversation'])
  })

  it('registers the page dictionaries on apply', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    expect(world.dictionaries).toEqual([{ ns: 'zotero', dict: { zh, en } }])
  })

  it('registers the zotero command-input projection and its chat node renderer', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
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

  it('reads the shared form for the shared namespace constant', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    expect(world.formIds).toEqual([ZOTERO_SETTINGS_NAMESPACE])
  })

  it('mounts the zotero Remote namespace contribution', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    expect(world.mounts).toHaveLength(1)
    const contribution = world.mounts[0] as { package: string }
    expect(contribution.package).toBe('dsh-zotero')
  })

  it('injects the configuration page into the settings.section slot', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    // All surfaces register synchronously: the command-input projection, the
    // page, the plugin-manager cards, and the conversation tab (whose
    // registration must not wait on the Remote mount).
    expect(world.injected.map((entry) => entry.name)).toEqual([
      'tool.call.toolview',
      'conversation.chat.node',
      'settings.section',
      'plugins.bundle.activation',
      'plugins.bundle.config',
      'plugins.detail.section',
      'conversation.chat.commandview',
      'conversation.view',
    ])

    const pageEntry = world.injected.find((entry) => entry.name === 'settings.section')
    expect(pageEntry?.register()).toBeDefined()

    const page = world.registered.find((entry) => entry.name === 'settings.section')
    // The left-nav identity: a stable key, a position inside the shipped
    // block, and registrant-localized nav text.
    expect(page?.options.id).toBe('zotero')
    expect(page?.options.order).toBe(25)
    expect(page?.options.locale).toBe('zotero')
    expect((page?.options.label as () => string)()).toBe('nav')
    expect(typeof page?.component).toBe('function')
    // The page's inject face carries the staged form's store.
    const pageInject = page?.options.inject as () => {
      hooks: { zoteroCard: unknown }
    }
    expect(pageInject().hooks.zoteroCard).toBeDefined()
  })

  it('injects the activation guide into the plugins.bundle.activation slot', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)

    const entry = world.injected.find((e) => e.name === 'plugins.bundle.activation')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const guide = world.registered.find((e) => e.name === 'plugins.bundle.activation')
    expect(guide?.options.key).toBe('dsh-zotero')
    expect(typeof guide?.component).toBe('function')
    const guideInject = (
      guide?.options.inject as () => { probe: () => Promise<unknown>; t: unknown }
    )()
    expect(typeof guideInject.probe).toBe('function')
    expect(typeof guideInject.t).toBe('function')
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
    apply(world.ctx as Context)
    await settleMount(world)

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

    resolveStatus({ ok: true, value: { connected: true, diagnosis: 'ok' } })
    await Promise.all([task1, task2])

    const task3 = guideInject.probe()
    expect(task3).not.toBe(task1)
    expect(statusCallCount).toBe(2)
    resolveStatus({ ok: true, value: { connected: true, diagnosis: 'ok' } })
    await task3
  })

  it('injects the bundle quick config into the plugins.bundle.config slot', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)

    const entry = world.injected.find((e) => e.name === 'plugins.bundle.config')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const config = world.registered.find((e) => e.name === 'plugins.bundle.config')
    expect(config?.options.key).toBe('dsh-zotero')
    expect(typeof config?.component).toBe('function')
    const configInject = (config?.options.inject as () => { form: unknown; t: unknown })()
    expect(configInject.form).toBe(world.scope)
    expect(typeof configInject.t).toBe('function')
  })

  it('injects the detail section into the plugins.detail.section slot', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)

    const entry = world.injected.find((e) => e.name === 'plugins.detail.section')
    expect(entry).toBeDefined()
    expect(entry?.register()).toBeDefined()

    const section = world.registered.find((e) => e.name === 'plugins.detail.section')
    expect(section?.options.id).toBe('zotero-status')
    expect(typeof section?.component).toBe('function')
    const sectionInject = (
      section?.options.inject as () => { probe: () => Promise<unknown>; t: unknown }
    )()
    expect(typeof sectionInject.probe).toBe('function')
    expect(typeof sectionInject.t).toBe('function')
  })

  it('injects and registers the zotero command card into the conversation.chat.commandview slot', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)

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

  it('keeps the tab and reports the fault when the Remote namespace is not served', async () => {
    const world = fakeWorld(true)
    apply(world.ctx as Context)
    await settleMount(world)
    // The tab's Sources workspace reads the session's own tool calls, so a
    // probe that cannot mount must not take the tab down with it.
    const tabEntry = world.injected.find((entry) => entry.name === 'conversation.view')
    expect(tabEntry).toBeDefined()
    tabEntry?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    const face = (registration?.options.inject as () => { status: () => Promise<unknown> })()
    // The strip names the fault instead of the tab vanishing silently, and it
    // says where the mount got to: a settled mount with no namespace is a
    // different failure from a queue that never advanced.
    await expect(face.status()).rejects.toThrow(/is not mounted \(mount settled\)/)
  })

  it('keeps the tab and logs the fault when the mount itself rejects', async () => {
    const world = fakeWorld(true, new Error('gateway offline'))
    const errors: unknown[][] = []
    const consoleError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }
    try {
      apply(world.ctx as Context)
      await settleMount(world)
    } finally {
      console.error = consoleError
    }
    // The tab stays: a rejected mount degrades the status strip instead of
    // removing the tab.
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)
    expect(errors.some((args) => String(args[0]).includes('gateway offline'))).toBe(true)
    expect(errors.some((args) => String(args[0]).includes('mount failed'))).toBe(true)
  })

  it('names a non-Error mount rejection instead of dropping it', async () => {
    const world = fakeWorld(true, 'gateway exploded')
    const errors: unknown[][] = []
    const consoleError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }
    try {
      apply(world.ctx as Context)
      await settleMount(world)
    } finally {
      console.error = consoleError
    }
    expect(errors.some((args) => String(args[0]).includes('gateway exploded'))).toBe(true)
    expect(errors.some((args) => String(args[0]).includes('mount failed'))).toBe(true)
  })

  it('reads the namespace face through the service store, never the dotted child read', async () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    // The fixture's `ctx.remote.zotero` throws the cordis inject guard the way
    // the runtime does, so reaching the status face at all proves the entry
    // went through the store: `$mount` installs the namespace on the gateway's
    // own context, and only the store path resolves it across fiber branches.
    await settleMount(world)
    expect(world.reflectCalls).toBeGreaterThan(0)
    const tab = world.injected.find((entry) => entry.name === 'conversation.view')
    tab?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    const face = (registration?.options.inject as () => { status: () => Promise<unknown> })()
    await expect(face.status()).resolves.toEqual({
      ok: true,
      value: { connected: true, diagnosis: 'ok' },
    })
  })

  it('disposes the mount and clears the face with the fiber', async () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    const dispose = await settleMount(world)
    expect(world.mountDisposes).toBe(0)
    dispose()
    expect(world.mountDisposes).toBe(1)
  })

  it('registers the Zotero conversation tab while webEnabled is not off', async () => {
    const world = fakeWorld()
    const statusSpy = vi.fn(async () => ({ ok: true, value: {} }))
    world.status = statusSpy
    apply(world.ctx as Context)
    await settleMount(world)
    const tab = world.injected.find((entry) => entry.name === 'conversation.view')
    expect(tab).toBeDefined()
    tab?.register()
    const registration = world.registered.find((entry) => entry.name === 'conversation.view')
    expect(registration?.options.id).toBe('zotero')
    expect(registration?.options.order).toBe(30)
    expect(registration?.options.locale).toBe('zotero')
    expect((registration?.options.label as () => string)()).toBe('nav')
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
      apply(world.ctx as Context)
      await settleMount(world)
      expect(
        world.injected.some((entry) => entry.name === 'conversation.view'),
        `tab on ${status}`,
      ).toBe(true)
    }
  })

  it('skips the tab when the namespace disables webEnabled', async () => {
    const world = fakeWorld()
    world.scope = fakeScope({
      value: { webEnabled: false },
      user: { webEnabled: false },
    })
    apply(world.ctx as Context)
    await settleMount(world)
    expect(world.injected.map((entry) => entry.name)).toEqual([
      'tool.call.toolview',
      'conversation.chat.node',
      'settings.section',
      'plugins.bundle.activation',
      'plugins.bundle.config',
      'plugins.detail.section',
      'conversation.chat.commandview',
    ])
  })

  it('injects and registers all 11 tool views into the tool.call.toolview slot', () => {
    const world = fakeWorld()
    apply(world.ctx as Context)

    const entry = world.injected.find((item) => item.name === 'tool.call.toolview')
    expect(entry).toBeDefined()
    entry?.register()

    const toolRegistrations = world.registered.filter((item) => item.name === 'tool.call.toolview')
    expect(toolRegistrations.map((item) => item.options.key)).toEqual([
      'zotero_search',
      'zotero_retrieve',
      'zotero_export',
      'zotero_get',
      'zotero_children',
      'zotero_attachment',
      'zotero_create_note',
      'zotero_add_tags',
      'zotero_add_to_collection',
      'zotero_browse',
      'zotero_changes',
    ])
    for (const reg of toolRegistrations) {
      expect(reg.options.locale).toBe('zotero')
      expect(typeof reg.component).toBe('function')
    }
  })

  it('withdraws the tab live when webEnabled turns off and restores it on', async () => {
    const world = fakeWorld()
    apply(world.ctx as Context)
    await settleMount(world)
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // Toggle the flag: the gate subscription withdraws the tab. The fake scope
    // publishes its listeners synchronously inside the write, so the awaited
    // write is the whole wait — the tab is withdrawn by the time it resolves.
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
    apply(world.ctx as Context)
    // Synchronous effects return disposers on the spot; the Remote mount is
    // the one async effect. Identify them by their side effects rather than
    // by position, so inserting a registration cannot silently re-point a
    // disposer at the wrong effect.
    const syncDisposers = world.effects.filter(
      (entry): entry is () => void => typeof entry === 'function',
    )
    const disposeProjection = syncDisposers[0]!
    const disposeCard = syncDisposers[1]!
    const disposeTab = syncDisposers[2]!
    const disposeRemote = await settleMount(world)
    expect(world.scope.unsubscribes).toBe(0)
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // The command-input projection goes with its own effect.
    disposeProjection()
    expect(world.eventDisposes).toBe(1)

    // The card form goes with its own effect, releasing the subscription.
    disposeCard()
    expect(world.scope.unsubscribes).toBe(1)

    // The tab goes with its own effect, without waiting on the mount.
    disposeTab()
    expect(world.injectDisposes).toBe(1)
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
    expect(world.mountDisposes).toBe(0)

    disposeRemote()
    expect(world.mountDisposes).toBe(1)
  })

  it('injects a page face whose scope reads the namespace snapshot', async () => {
    const world = fakeWorld()
    world.scope = fakeScope({
      value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 },
    })
    apply(world.ctx as Context)
    await settleMount(world)
    const entry = world.injected.find((entry) => entry.name === 'settings.section')
    expect(entry?.register()).toBeDefined()
    const registration = world.registered.find((entry) => entry.name === 'settings.section')
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
