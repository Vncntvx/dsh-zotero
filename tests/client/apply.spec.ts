/**
 * Browser-half entry: the apply wiring registers the page dictionaries,
 * mounts the zotero Typert Remote namespace, and injects a
 * `settings.section` registration for id `zotero` against a hand-rolled
 * context — the same surface the loader kernel exercises.
 * @module tests/client/apply
 */

import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../../src/client/index.ts'
import { en, zh } from '../../src/client/locales.ts'
import type { ZoteroConfigView } from '../../src/client/remote.ts'

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
  }
})

const VIEW: ZoteroConfigView = {
  available: true,
  writable: true,
  value: { baseUrl: 'http://127.0.0.1:23119/api', timeoutMs: 5000 },
  base: { baseUrl: 'http://127.0.0.1:23119/api' },
  user: undefined,
  revision: 0,
}

interface FakeSlotsEntry {
  name: string
  options: Record<string, unknown>
  component: unknown
}

interface FakeApplyWorld {
  ctx: unknown
  dictionaries: Array<{ ns: string; dict: unknown }>
  injected: Array<{ name: string; register: () => FakeSlotsEntry | undefined }>
  registered: FakeSlotsEntry[]
  mounts: unknown[]
  effects: Array<unknown>
  mountDisposes: number
}

/** A minimal context standing in for the browser kernel's plugin ctx. */
function fakeWorld(mountFail = false): FakeApplyWorld {
  const dictionaries: FakeApplyWorld['dictionaries'] = []
  const injected: FakeApplyWorld['injected'] = []
  const registered: FakeApplyWorld['registered'] = []
  const mounts: FakeApplyWorld['mounts'] = []
  const effects: FakeApplyWorld['effects'] = []
  // The world object is shared with the ctx closures (mountDisposes included),
  // so the returned handle observes the disposer's side effects.
  const world: FakeApplyWorld = {
    ctx: undefined,
    dictionaries,
    injected,
    registered,
    mounts,
    effects,
    mountDisposes: 0,
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
              config: async () => ({ ok: true, value: VIEW }),
              configUpdate: async () => ({ ok: true, value: VIEW }),
              configClear: async () => ({ ok: true, value: VIEW }),
            },
    },
    slots: {
      inject: (name: string, register: () => FakeSlotsEntry | undefined) => {
        injected.push({ name, register })
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
    expect(inject).toEqual(['locale', 'slots', 'remote'])
  })

  it('registers the page dictionaries on apply', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.dictionaries).toEqual([{ ns: 'zotero', dict: { zh, en } }])
  })

  it('mounts the zotero Remote namespace contribution', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.mounts).toHaveLength(1)
    const contribution = world.mounts[0] as { package: string }
    expect(contribution.package).toBe('dsh-zotero')
  })

  it('injects a zotero section registration into the settings panel', () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    expect(world.injected).toHaveLength(1)
    const entry = world.injected[0]
    expect(entry?.name).toBe('settings.section')
    const slot = entry?.register()
    expect(slot).toBeDefined()
    expect(world.registered).toHaveLength(1)
    const registration = world.registered[0]
    expect(registration?.name).toBe('settings.section')
    expect(registration?.options.id).toBe('zotero')
    expect(registration?.options.order).toBe(30)
    expect(registration?.options.locale).toBe('zotero')
    expect(registration?.options.label).toBeTypeOf('function')
    expect(typeof registration?.component).toBe('function')
    // The nav label resolves through the bound locale reader.
    expect((registration?.options.label as () => string)()).toBe('nav')
    // The nav glyph rides the registration as JSON icon data.
    expect(registration?.options.icon).toEqual({
      path: 'M21.231 2.462 7.18 20.923h14.564V24H2.256v-2.462L16.308 3.076H2.975V0h18.256v2.462z',
    })
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

  it('injects a page face whose scope reads through the Remote namespace', async () => {
    const world = fakeWorld()
    apply(world.ctx as ClientContext)
    // The mount settles on the microtask queue; let the first load publish.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const entry = world.injected[0]
    expect(entry?.register()).toBeDefined()
    const injectFn = world.registered[0]?.options.inject as () => {
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
