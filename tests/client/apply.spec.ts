/**
 * Browser-half entry: the apply wiring registers the page dictionaries, binds
 * the zotero settings namespace through the injected settings scope, injects
 * the configuration card into the keyed `settings.plugin.item` slot, and
 * mounts the zotero Typert Remote namespace for the conversation tab's live
 * status, gating that tab on the namespace's `webEnabled` flag.
 * @module tests/client/apply
 */

import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'
import { ZOTERO_SETTINGS_NAMESPACE } from '../../src/settings-namespace.ts'
import { fakeScope } from './helpers/fake-scope.ts'

// The page imports the primitives controls; stub them so this wiring-level
// spec does not load the real bundle (katex css, shiki, …).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Input: (props: Record<string, unknown>) => createElement('input', props),
    Button: ({
      children,
      ...rest
    }: Record<string, unknown> & { children?: import('react').ReactNode }) =>
      createElement('button', { type: 'button', ...rest }, children),
    IconChevronDownOutline14: () => null,
  }
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
  bindSpecs: Array<{ namespace: string; decode?: (section: unknown) => unknown }>
  scope: ReturnType<typeof fakeScope>
  /** Scripted namespace `status` result; defaults to ok. */
  status: () => Promise<unknown>
}

/** A minimal context standing in for the browser kernel's plugin ctx. */
function fakeWorld(mountFail = false): FakeApplyWorld {
  const dictionaries: FakeApplyWorld['dictionaries'] = []
  const injected: FakeInjectedEntry[] = []
  const registered: FakeApplyWorld['registered'] = []
  const mounts: FakeApplyWorld['mounts'] = []
  const effects: FakeApplyWorld['effects'] = []
  const bindSpecs: FakeApplyWorld['bindSpecs'] = []
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
    bindSpecs,
    scope,
    status: async () => ({ ok: true, value: { connected: true, diagnosis: 'ok' } }),
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
        return () => {
          world.mountDisposes += 1
        }
      },
    },
    reflect: {
      get: () =>
        mountFail
          ? undefined
          : {
              status: world.status,
            },
    },
    settingsScope: {
      bind: (spec: { namespace: string; decode?: (section: unknown) => unknown }) => {
        bindSpecs.push(spec)
        return world.scope
      },
    },
    slots: {
      inject: (name: string, register: () => FakeSlotsEntry | undefined) => {
        const entry: FakeInjectedEntry = { name, register, active: true }
        injected.push(entry)
        return () => {
          entry.active = false
          world.injectDisposes += 1
        }
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        registered.push({ name: String(options.name), options, component })
        return { id: String(options.id) }
      },
    },
  }
  world.ctx = ctx
  return world
}

describe('the browser-half entry', () => {
  it('declares the services it consumes', () => {
    expect(inject).toEqual(['locale', 'slots', 'connection', 'settingsScope', 'remote'])
  })

  it('registers the page dictionaries on apply', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.dictionaries).toEqual([{ ns: 'zotero', dict: { zh, en } }])
  })

  it('binds the settings scope to the shared namespace constant', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.bindSpecs).toHaveLength(1)
    expect(world.bindSpecs[0]?.namespace).toBe(ZOTERO_SETTINGS_NAMESPACE)
    // The lenient decode passes plain sections through and refuses non-objects.
    const decode = world.bindSpecs[0]?.decode
    expect(decode).toBeTypeOf('function')
    expect(decode?.({ webEnabled: true })).toEqual({ webEnabled: true })
    expect(decode?.({})).toEqual({})
    expect(decode?.(null)).toBeUndefined()
    expect(decode?.(['not', 'a', 'section'])).toBeUndefined()
  })

  it('mounts the zotero Remote namespace contribution', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.mounts).toHaveLength(1)
    const contribution = world.mounts[0] as { package: string }
    expect(contribution.package).toBe('dsh-zotero')
  })

  it('injects the configuration card into the keyed settings.plugin.item slot', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.injected.map((entry) => entry.name)).toEqual(['settings.plugin.item'])

    const cardEntry = world.injected.find((entry) => entry.name === 'settings.plugin.item')
    expect(cardEntry?.register()).toBeDefined()

    const card = world.registered.find((entry) => entry.name === 'settings.plugin.item')
    expect(card?.options.key).toBe(ZOTERO_SETTINGS_NAMESPACE)
    expect(card?.options.locale).toBe('zotero')
    expect(card?.options.id).toBeUndefined()
    expect(card?.options.order).toBeUndefined()
    expect(typeof card?.component).toBe('function')
    // The card's inject face carries the staged form's store.
    const cardInject = card?.options.inject as () => {
      hooks: { zoteroCard: unknown }
    }
    expect(cardInject().hooks.zoteroCard).toBeDefined()
  })

  it('fails the mount when the Remote namespace is not served', async () => {
    const world = fakeWorld(true)
    apply(world.ctx as ClientContext)
    const mount = world.effects[1]
    expect(mount).toBeTypeOf('object')
    await expect(Promise.resolve(mount)).rejects.toThrow(/did not mount/)
  })

  it('disposes the mount and clears the face with the fiber', async () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    const dispose = (await world.effects[1]) as () => void
    expect(world.mountDisposes).toBe(0)
    dispose()
    expect(world.mountDisposes).toBe(1)
  })

  it('registers the Zotero conversation tab while webEnabled is not off', async () => {
    const world = fakeWorld()
    const statusSpy = vi.fn(async () => ({ ok: true, value: {} }))
    world.status = statusSpy
    apply(world.ctx as ClientContext)
    await new Promise((resolve) => setTimeout(resolve, 0))
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
      apply(world.ctx as ClientContext)
      await new Promise((resolve) => setTimeout(resolve, 0))
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
    apply(world.ctx as ClientContext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(world.injected.map((entry) => entry.name)).toEqual(['settings.plugin.item'])
  })

  it('withdraws the tab live when webEnabled turns off and restores it on', async () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)

    // Toggle the flag: the gate subscription withdraws the tab.
    await world.scope.set('webEnabled', false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
    expect(world.injectDisposes).toBe(1)

    // Toggle back on: the tab returns (a fresh live registration).
    await world.scope.set('webEnabled', true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(
      world.injected
        .filter((entry) => entry.name === 'conversation.view')
        .some((entry) => entry.active),
    ).toBe(true)
  })

  it('withdraws the tab with the fiber and unmounts the Remote', async () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    const dispose = (await world.effects[1]) as () => void
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(world.injected.some((entry) => entry.name === 'conversation.view')).toBe(true)
    dispose()
    expect(world.mountDisposes).toBe(1)
    expect(world.injectDisposes).toBe(1)
    expect(world.injected.find((entry) => entry.name === 'conversation.view')?.active).toBe(false)
  })

  it('injects a card face whose scope reads the namespace snapshot', async () => {
    const world = fakeWorld()
    world.scope = fakeScope({
      value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 },
    })
    apply(world.ctx as ClientContext)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const entry = world.injected.find((entry) => entry.name === 'settings.plugin.item')
    expect(entry?.register()).toBeDefined()
    const registration = world.registered.find((entry) => entry.name === 'settings.plugin.item')
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
