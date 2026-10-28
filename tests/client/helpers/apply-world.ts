/**
 * The browser-half entry's shared fake world: a minimal context standing in
 * for the browser kernel's plugin ctx, recording every registration the entry
 * makes so the apply specs assert wiring, gating, and disposal against it.
 * @module tests/client/helpers/apply-world
 */

import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../../../src/client/index.ts'
import {
  SCHOLARLY_SETTINGS_NAMESPACE,
  ZOTERO_SETTINGS_NAMESPACE,
} from '../../../src/settings-namespace.ts'
import { ZOTERO_LIBRARY_SETTINGS_NAMESPACE } from '../../../src/contract.ts'
import { fakeScope } from './fake-scope.ts'
import { fakeEntryErrorSeam, type EntryErrorListener } from './slot-crash-seam.ts'

export interface FakeSlotsEntry {
  name: string
  options: Record<string, unknown>
  component: unknown
}

export interface FakeInjectedEntry {
  name: string
  register: () => FakeSlotsEntry | undefined
  /** False once the disposer the inject call returned has run (withdrawn). */
  active: boolean
}

export interface FakeApplyWorld {
  ctx: unknown
  dictionaries: Array<{ ns: string; dict: unknown }>
  injected: Array<FakeInjectedEntry>
  registered: FakeSlotsEntry[]
  mounts: unknown[]
  effects: Array<unknown>
  mountDisposes: number
  injectDisposes: number
  formIds: string[]
  /** The `zotero` namespace's form (webEnabled and the plugin's own fields). */
  scope: ReturnType<typeof fakeScope>
  /** The `library` namespace's form (left/right sidebar toggles). */
  libraryScope: ReturnType<typeof fakeScope>
  /** The `scholarly` namespace's form. */
  scholarlyScope: ReturnType<typeof fakeScope>
  /** Scripted namespace `status` result; defaults to ok. */
  status: () => Promise<unknown>
  resolveAttachment: (ref: string) => Promise<unknown>
  /** The wire reads/writes the library panel face forwards. */
  libraryWire: {
    browse: (request: unknown) => Promise<unknown>
    search: (request: unknown) => Promise<unknown>
    item: (request: unknown) => Promise<unknown>
    childPage: (request: unknown) => Promise<unknown>
    write: (request: unknown) => Promise<unknown>
  }
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
  /** SidebarRight tab definitions registered. */
  sidebarRightTabDefinitions: Array<unknown>
  /** Disposers run for those tab definitions. */
  sidebarRightTabDisposes: number
  /** Supervision listeners the entry registered through `slots.onEntryError`. */
  entryErrorListeners: EntryErrorListener[]
  /** Namespaces currently served by the host; defaults to both zotero and scholarly. */
  servedNamespaces?: Set<string>
  whileServedRegistrations: Array<{ namespaces: readonly string[] }>
  whileServedDisposes: number
  /** Slot names in the order their inject disposers ran. */
  disposeOrder: string[]
}

/** A minimal context standing in for the browser kernel's plugin ctx. */
export function fakeWorld(
  mountRejects: unknown = undefined,
  injectRejects: unknown = undefined,
): FakeApplyWorld {
  const dictionaries: FakeApplyWorld['dictionaries'] = []
  const injected: FakeInjectedEntry[] = []
  const registered: FakeApplyWorld['registered'] = []
  const mounts: FakeApplyWorld['mounts'] = []
  const effects: FakeApplyWorld['effects'] = []
  const formIds: string[] = []
  const seam = fakeEntryErrorSeam()
  const entryErrorListeners: EntryErrorListener[] = seam.listeners
  const scope = fakeScope()
  const libraryScope = fakeScope()
  const scholarlyScope = fakeScope()
  // One form per settings namespace. The `zotero` form resolves through
  // `world.scope` at call time so a spec can replace it wholesale (the
  // webEnabled gating specs do); a test that writes `rightSidebarEnabled`
  // through that form must not move the library toggles, which is exactly the
  // namespace mismatch this harness exists to catch.
  const forms: Record<string, ReturnType<typeof fakeScope>> = {
    [ZOTERO_LIBRARY_SETTINGS_NAMESPACE]: libraryScope,
    [SCHOLARLY_SETTINGS_NAMESPACE]: scholarlyScope,
  }
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
    libraryScope,
    scholarlyScope,
    status: async () => ({ ok: true, value: { connected: true } }),
    resolveAttachment: async (ref: string) => ({ ok: true, value: { ref, kind: 'file' } }),
    libraryWire: {
      browse: async () => ({
        ok: true,
        value: { kind: 'libraries', items: [], total: 0, offset: 0, returned: 0, limit: 50 },
      }),
      search: async () => ({
        ok: true,
        value: {
          scope: { kind: 'library', library: { type: 'user', id: 0 } },
          items: [],
          total: 0,
          offset: 0,
          returned: 0,
          limit: 50,
        },
      }),
      item: async () => ({
        ok: true,
        value: {
          ref: 'zotero://user/0/item/ABCD1234',
          itemType: 'journalArticle',
          title: 'Paper',
          creators: [],
          abstractTruncated: false,
          tags: [],
          collections: [],
          children: { total: 0 },
        },
      }),
      childPage: async () => ({
        ok: true,
        value: { kind: 'notes', page: { total: 0, returned: 0, offset: 0, limit: 50, items: [] } },
      }),
      write: async () => ({ ok: true, value: { kind: 'applied', message: 'done' } }),
    },
    injectDeps: [],
    uiDisposes: 0,
    disposeOrder: [],
    eventDefinitions: [],
    eventDisposes: 0,
    openResourceCalls: [],
    sidebarRightTabDefinitions: [],
    sidebarRightTabDisposes: 0,
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
        browse: (request: unknown) => world.libraryWire.browse(request),
        search: (request: unknown) => world.libraryWire.search(request),
        item: (request: unknown) => world.libraryWire.item(request),
        childPage: (request: unknown) => world.libraryWire.childPage(request),
        write: (request: unknown) => world.libraryWire.write(request),
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
      const promise =
        injectRejects !== undefined ? Promise.reject(injectRejects) : Promise.resolve({ dispose })
      return Object.assign(promise, { dispose })
    },
    configForms: {
      get: (id: string) => {
        formIds.push(id)
        if (id === ZOTERO_SETTINGS_NAMESPACE) return world.scope
        // An unknown namespace reads as permanently unavailable, exactly like
        // the real mirror: the form exists but no served section names it.
        return forms[id] ?? fakeScope({ status: 'unavailable' })
      },
      whileServed: (
        namespaces: readonly string[],
        register: (served: ReadonlySet<string>) => () => void,
      ) => {
        world.whileServedRegistrations.push({ namespaces })
        const served =
          world.servedNamespaces ?? new Set([ZOTERO_SETTINGS_NAMESPACE, ...Object.keys(forms)])
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
    sidebarRightTabs: {
      register: (definition: unknown) => {
        world.sidebarRightTabDefinitions.push(definition)
        return () => {
          world.sidebarRightTabDisposes += 1
        }
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
          world.disposeOrder.push(name)
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
export async function applyEntry(world: FakeApplyWorld): Promise<() => Promise<void>> {
  return await apply(world.ctx as Context)
}
