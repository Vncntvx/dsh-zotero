/**
 * The browser-half entry's shared fake world: a minimal context standing in
 * for the browser kernel's plugin ctx, recording every registration the entry
 * makes so the apply specs assert wiring, gating, and disposal against it.
 * @module tests/client/helpers/apply-world
 */

import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../../../src/client/index.ts'
import {
  ENRICHMENT_SETTINGS_NAMESPACE,
  SCHOLARLY_SETTINGS_NAMESPACE,
  ZOTERO_SETTINGS_NAMESPACE,
} from '../../../src/settings-namespace.ts'
import { ZOTERO_LIBRARY_SETTINGS_NAMESPACE } from '../../../src/contract.ts'
import {
  createRemoteAccessStub,
  createRemoteZoteroStub,
  createParseRuntimeStub,
} from './remote-stubs.ts'
import { fakeScope } from './fake-scope.ts'
import { createFakeContextMenus, type FakeContextMenuRegistration } from './fake-context-menus.ts'
import { fakeProvideRoot } from './fake-slot-root.ts'
import { fakeEntryErrorSeam, type EntryErrorListener } from './slot-crash-seam.ts'
import { emptyCredentialPort } from './credential-port.ts'
import { fakeLibraryWire, type FakeLibraryWire } from './library-wire-stubs.ts'

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
  /** The `enrichment` namespace's form. */
  enrichmentScope: ReturnType<typeof fakeScope>
  /** Scripted namespace `status` result; defaults to ok. */
  status: () => Promise<unknown>
  resolveAttachment: (ref: string) => Promise<unknown>
  /** The wire reads/writes the library panel face forwards. */
  libraryWire: FakeLibraryWire
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
  /** Every page the `sidebarRight` service was asked to open, with its captured session. */
  openTabCalls: Array<{ sessionId?: string; kind: string }>
  /** Every protocol URL the Remote namespace was asked to launch. */
  openProtocolCalls: string[]
  /** Every context-menu toast, in call order. */
  notifications: Array<{ text: string; success: boolean }>
  /** SidebarRight tab definitions registered. */
  sidebarRightTabDefinitions: Array<unknown>
  /** Disposers run for those tab definitions. */
  sidebarRightTabDisposes: number
  /** Supervision listeners the entry registered through `slots.onEntryError`. */
  entryErrorListeners: EntryErrorListener[]
  /** Context menu contributions registered through `ctx.contextMenus.register`. */
  contextMenuRegistrations: FakeContextMenuRegistration[]
  /** Disposers run for context menu contributions. */
  contextMenuDisposes: number
  /** Namespaces currently served by the host; defaults to both zotero and scholarly. */
  servedNamespaces?: Set<string>
  /**
   * The endpoint actions this Peer may call. Defaults to every Zotero
   * action (the owner); a spec narrows it to model a viewer without a grant.
   */
  grantedActions: Set<string>
  whileServedRegistrations: Array<{ namespaces: readonly string[] }>
  whileServedDisposes: number
  /** Slot names in the order their inject disposers ran. */
  disposeOrder: string[]
  /** Root props installed through `slots.provideRoot`, if any. */
  rootProps?: Record<string, unknown>
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
  const contextMenuRegistrations: FakeApplyWorld['contextMenuRegistrations'] = []
  const seam = fakeEntryErrorSeam()
  const entryErrorListeners: EntryErrorListener[] = seam.listeners
  const scope = fakeScope()
  const libraryScope = fakeScope()
  const scholarlyScope = fakeScope()
  const enrichmentScope = fakeScope()
  // Keep shared forms distinct: library flags written through the core form do not apply.
  // Resolve world.scope live so settings-gating specs can replace the core form.
  const forms: Record<string, ReturnType<typeof fakeScope>> = {
    [ZOTERO_LIBRARY_SETTINGS_NAMESPACE]: libraryScope,
    [SCHOLARLY_SETTINGS_NAMESPACE]: scholarlyScope,
    [ENRICHMENT_SETTINGS_NAMESPACE]: enrichmentScope,
  }
  const whileServedRegistrations: FakeApplyWorld['whileServedRegistrations'] = []
  // Every Zotero endpoint action is granted by default: the world models the
  // owner, the only Peer whose access answer is true for everything. A spec
  // narrows the set to model a viewer without a grant.
  const grantedActions = new Set(
    'zotero/status,zotero/browse,zotero/search,zotero/item,zotero/childPage,zotero/export,zotero/resolveAttachment,zotero/openProtocol,zotero/readUrlPdf,zotero/releaseUrlPdf,zotero/write,session:test-session:zotero/write'.split(
      ',',
    ),
  )
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
    enrichmentScope,
    status: async () => ({ ok: true, value: { connected: true } }),
    resolveAttachment: async (ref: string) => ({ ok: true, value: { ref, kind: 'file' } }),
    libraryWire: fakeLibraryWire(),
    injectDeps: [],
    uiDisposes: 0,
    disposeOrder: [],
    eventDefinitions: [],
    eventDisposes: 0,
    openResourceCalls: [],
    openTabCalls: [],
    openProtocolCalls: [],
    notifications: [],
    sidebarRightTabDefinitions: [],
    sidebarRightTabDisposes: 0,
    contextMenuRegistrations,
    contextMenuDisposes: 0,
    entryErrorListeners,
    grantedActions,
    whileServedRegistrations,
    whileServedDisposes: 0,
  }
  // Effects belong to the active fiber; disposing it unwinds its registrations.
  let collector: Array<() => void> | undefined
  const ctx = {
    ...createParseRuntimeStub(),
    effect: (register: () => unknown): (() => void) => {
      const dispose = register()
      const disposer = typeof dispose === 'function' ? (dispose as () => void) : () => {}
      effects.push(dispose)
      collector?.push(disposer)
      return disposer
    },
    locale: {
      register: (ns: string, dict: unknown) => void dictionaries.push({ ns, dict }),
      bind: () => (key: string) => key,
    },
    remoteAccess: createRemoteAccessStub(world.grantedActions),
    remote: {
      $mount: async (contribution: unknown) => {
        mounts.push(contribution)
        if (mountRejects !== undefined) throw mountRejects
        return () => void (world.mountDisposes += 1)
      },
      $on: (_event: string, _listener: (payload: unknown) => void) => () => undefined,
      credentials: emptyCredentialPort,
      zotero: createRemoteZoteroStub(world),
    },
    /**
     * Start a fiber for `deps`, run its callback, and hand back the disposer
     * that unwinds the effects it registered: the shape
     * `vendor/cordis/src/registry.ts` gives `ctx.inject`.
     */
    inject: (deps: readonly string[], callback: (ctx: unknown) => void) => {
      world.injectDeps.push([...deps])
      const isUiFiber = deps.includes('remote.zotero')
      const owned: Array<() => void> = []
      const dispose = async () => {
        for (const disposer of owned.reverse()) disposer()
        if (isUiFiber) world.uiDisposes += 1
      }
      if (isUiFiber && injectRejects !== undefined) {
        return Object.assign(Promise.reject(injectRejects), { dispose })
      }
      const previousCollector = collector
      collector = owned
      try {
        const allPresent = deps.every((dep) => {
          const [parent, child] = dep.split('.')
          return child
            ? (ctx as any)[parent]?.[child] !== undefined
            : (ctx as any)[dep] !== undefined
        })
        if (allPresent) callback(ctx)
      } finally {
        collector = previousCollector
      }
      return Object.assign(Promise.resolve({ dispose }), { dispose })
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
      openTabs: { getSnapshot: () => [], subscribe: () => () => {} },
      openResource: (url: string) => {
        world.openResourceCalls.push(url)
      },
      openTab: (kind: string) => {
        world.openTabCalls.push({ kind })
      },
      openTabIn: (sessionId: string, kind: string) => {
        world.openTabCalls.push({ sessionId, kind })
      },
    },
    sidebarRightTabs: {
      register: (definition: unknown) => {
        world.sidebarRightTabDefinitions.push(definition)
        return () => {
          world.sidebarRightTabDisposes += 1
        }
      },
      get: (kind: string) =>
        world.sidebarRightTabDefinitions.find(
          (definition) => (definition as { kind?: string }).kind === kind,
        ),
    },
    contextMenus: createFakeContextMenus(world),
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
      provideRoot: fakeProvideRoot(world),
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
