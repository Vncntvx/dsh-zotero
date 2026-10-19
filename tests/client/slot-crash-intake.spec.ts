// @vitest-environment jsdom
/**
 * The slot-level crash intake: the browser half files every crashed slot entry
 * into the host diagnostics ring through `ctx.slots.onEntryError`, the
 * renderer's own supervision seam.
 *
 * The seam is a plain subscription — it fires for a render throw, an `inject`
 * factory throw, an ordinary Slot and a Factory occurrence alike — so the spec
 * drives it directly with a scripted registry rather than mounting a crashing
 * entry through a real one: what the plugin owns is the callback it registers
 * and the report it files, and both are observable here.
 *
 * Ownership is the registrant stamp the renderer writes onto every entry
 * (`options.registrant ?? ctx.fiber?.name`, ui-renderer's registry), which the
 * fake registry below reproduces: the crash world's registrations carry the
 * stamp, and the filter reads it instead of guessing from keys or names.
 * @module tests/client/slot-crash-intake
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../../src/client/index.ts'
import { RETIRED_ENTRY } from '../../src/client/actions/error-reporter.ts'
import type { ZoteroClientErrorReport } from '../../src/contract.ts'
import { fakeScope } from './helpers/fake-scope.ts'
import { fakeEntryErrorSeam } from './helpers/slot-crash-seam.ts'

// The page imports primitive icons; stub them with the shared DOM face so this
// wiring-level spec does not load the real bundle (katex css, shiki, …).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const { primitivesWithRealForm } = await import('./helpers/primitives-stub.ts')
  return primitivesWithRealForm(importOriginal)
})

/** The registrant this plugin stamps on its own slot entries. */
const REGISTRANT = 'dsh-zotero'

/** One stored entry as the renderer's registry keeps it after stamping. */
function storedEntry(
  options: Record<string, unknown>,
  component: unknown = () => null,
): Record<string, unknown> {
  return {
    name: String(options.name),
    options,
    component,
    // The renderer stamps `options.registrant ?? ctx.fiber?.name`; the plugin
    // declares it explicitly, so an entry that forgot it would crash the real
    // filter the way this fake does.
    registrant: (options.registrant as string | undefined) ?? REGISTRANT,
  }
}

/** The world one applied entry ran against, plus the handle that drives it. */
interface IntakeWorld {
  /** The fake plugin context the entry was applied to. */
  ctx: ClientContext
  /** Call the listener the entry registered; throws when it registered none. */
  crash: (key: string, registration: unknown, error: unknown, info?: { abdicated: boolean }) => void
  /** Every report the namespace received, in order. */
  reports: ZoteroClientErrorReport[]
  /** Script the next report's answer; defaults to a success receipt. */
  respond: (next: () => Promise<unknown>) => void
  /** How many effect disposers have run. */
  disposals: () => number
}

/**
 * Build a context whose slot registry records the supervision listener instead
 * of rendering anything, and whose namespace journals every report.
 * @param journal - receives the reports the namespace is asked to file.
 * @returns the handle a test drives the intake with.
 */
function intakeWorld(journal: ZoteroClientErrorReport[]): IntakeWorld {
  let respond: () => Promise<unknown> = async () => ({ ok: true, value: { seq: 1 } })
  let disposals = 0
  const scope = fakeScope()
  const seam = fakeEntryErrorSeam()
  let collector: Array<() => void> | undefined
  const ctx = {
    effect: (register: () => unknown): (() => void) => {
      const dispose = register()
      const disposer = typeof dispose === 'function' ? (dispose as () => void) : () => {}
      collector?.push(() => {
        disposer()
        disposals += 1
      })
      return disposer
    },
    locale: { register: () => {}, bind: () => (key: string) => key },
    remote: {
      $mount: async () => async () => {},
      zotero: {
        status: async () => ({ ok: true, value: {} }),
        resolveAttachment: async (ref: string) => ({ ok: true, value: { ref, kind: 'file' } }),
        diagnostics: async () => ({ ok: true, value: { entries: [], total: 0 } }),
        reportClientError: (report: ZoteroClientErrorReport) => {
          journal.push(report)
          return respond()
        },
      },
    },
    inject: (_deps: readonly string[], callback: (ctx: unknown) => void) => {
      const owned: Array<() => void> = []
      collector = owned
      try {
        callback(ctx)
      } finally {
        collector = undefined
      }
      const dispose = async () => {
        for (const disposer of owned.reverse()) disposer()
      }
      return Object.assign(Promise.resolve({ dispose }), { dispose })
    },
    configForms: {
      get: () => scope,
      whileServed: (
        namespaces: readonly string[],
        register: (served: ReadonlySet<string>) => () => void,
      ) => register(new Set(namespaces)),
    },
    uiConversation: { events: { register: () => () => {} } },
    slots: {
      inject: () => () => {},
      register: (options: Record<string, unknown>, component: unknown) =>
        storedEntry(options, component),
      onEntryError: seam.onEntryError,
    },
  }
  return {
    ctx: ctx as unknown as ClientContext,
    crash: seam.crash,
    reports: journal,
    respond: (next) => {
      respond = next
    },
    disposals: () => disposals,
  }
}

/** Apply the browser entry and settle it, as the kernel does. */
async function mountIntake(world: IntakeWorld): Promise<() => Promise<void>> {
  return await apply(world.ctx)
}

describe('the slot crash intake', () => {
  it('files one report carrying the slot key, the message, and the stack', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    const failure = new Error('card render failed')
    world.crash(
      'tool.call.toolview',
      storedEntry({ name: 'tool.call.toolview', key: 'zotero_search', locale: 'zotero' }),
      failure,
      {
        abdicated: false,
      },
    )
    await Promise.resolve()

    expect(world.reports).toHaveLength(1)
    expect(world.reports[0]).toMatchObject({
      surface: 'tool.call.toolview',
      message: 'card render failed',
      stack: failure.stack,
    })
    // A contained crash retires nothing, so no abdication line is filed.
    expect(world.reports[0]?.componentStack).toBeUndefined()
  })

  it('names a Factory occurrence by the key the seam spells', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    // A Factory occurrence crash names the factory, and ui-renderer stamps
    // the registrant onto the stored factory definition.
    world.crash(
      'factory:zotero-card',
      { registrant: REGISTRANT, component: () => null },
      new Error('boom'),
      {
        abdicated: false,
      },
    )
    await Promise.resolve()

    expect(world.reports[0]?.surface).toBe('factory:zotero-card')
  })

  it('carries the abdication fact on the component stack when the entry was retired', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    world.crash(
      'conversation.view',
      storedEntry({ name: 'conversation.view', id: 'zotero', locale: 'zotero' }),
      new Error('panel exploded'),
      {
        abdicated: true,
      },
    )
    await Promise.resolve()

    // The wire report has no `abdicated` field, so the fact rides the one
    // free-text field the host ring keeps; a retired surface reads differently
    // from one that merely rendered a fallback.
    expect(world.reports[0]?.componentStack).toBe(RETIRED_ENTRY)
  })

  it('files a literally empty throw under the placeholder message', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    world.crash(
      'plugins.detail.section',
      storedEntry({ name: 'plugins.detail.section', id: 'zotero-status' }),
      '',
      {
        abdicated: false,
      },
    )
    await Promise.resolve()

    // The intake's wire contract refuses an empty message, so an empty thrown
    // string is filed under the placeholder rather than silently dropped.
    expect(world.reports[0]).toMatchObject({
      surface: 'plugins.detail.section',
      message: 'unknown failure',
    })
    expect(world.reports[0]?.stack).toBeUndefined()
  })

  it('keeps a rejected report from becoming a second failure', async () => {
    const world = intakeWorld([])
    await mountIntake(world)
    world.respond(() => Promise.reject(new Error('gateway down')))

    expect(() =>
      world.crash(
        'tool.call.toolview',
        storedEntry({ name: 'tool.call.toolview', key: 'zotero_search', locale: 'zotero' }),
        new Error('boom'),
        {
          abdicated: false,
        },
      ),
    ).not.toThrow()
    // Flush the rejection: an intake that leaked it would surface here.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(world.reports).toHaveLength(1)
  })

  it('ignores crashes from foreign slot registrations', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    // Another plugin's tool card: stamped with its own registrant, so the
    // shared `tool.call.toolview` key does not make it ours.
    world.crash(
      'tool.call.toolview',
      {
        registrant: 'some-other-plugin',
        options: { key: 'foreign_tool', locale: 'foreign' },
        name: 'tool.call.toolview',
        component: () => null,
      },
      new Error('foreign crash'),
      { abdicated: false },
    )
    world.crash(
      'editor.view',
      { registrant: 'another-plugin', component: () => null },
      new Error('editor crash'),
      { abdicated: true },
    )
    await Promise.resolve()

    expect(world.reports).toHaveLength(0)
  })

  it('ignores crashes from foreign or anonymous factory occurrences', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    world.crash(
      'factory:pdf-viewer',
      { registrant: 'some-other-plugin', component: () => null },
      new Error('foreign factory crash'),
      { abdicated: false },
    )
    world.crash(
      'factory:anonymous',
      { component: () => null },
      new Error('anonymous factory crash'),
      { abdicated: false },
    )
    await Promise.resolve()

    expect(world.reports).toHaveLength(0)
  })

  it('claims a registration whose key merely mentions zotero only by its registrant', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    // The key and the options carry "zotero", but the registration belongs to
    // another plugin: ownership is the registrant stamp, so this is foreign.
    world.crash(
      'conversation.chat.commandview',
      {
        registrant: 'some-other-plugin',
        options: { key: 'zotero', locale: 'zotero' },
        name: 'conversation.chat.commandview',
        component: () => null,
      },
      new Error('borrowed key'),
      { abdicated: false },
    )
    await Promise.resolve()

    expect(world.reports).toHaveLength(0)
  })

  it('claims an own registration whose key and id carry no zotero spelling', async () => {
    const world = intakeWorld([])
    await mountIntake(world)

    // The mirror image: nothing in the key, the id, or the options says
    // "zotero", but the registrant stamp does, so the crash is ours to file.
    world.crash(
      'conversation.view',
      storedEntry({ name: 'conversation.view', id: 'references', order: 30 }),
      new Error('our tab'),
      { abdicated: false },
    )
    await Promise.resolve()

    expect(world.reports).toHaveLength(1)
    expect(world.reports[0]).toMatchObject({ surface: 'conversation.view', message: 'our tab' })
  })

  it('withdraws the subscription with the fiber', async () => {
    const world = intakeWorld([])
    const dispose = await mountIntake(world)
    const before = world.disposals()
    await dispose()

    expect(world.disposals()).toBeGreaterThan(before)
    // The effect's disposer released the listener, so a crash arriving after
    // teardown files nothing at all: the seam has no listener left to fire.
    world.crash(
      'tool.call.toolview',
      storedEntry({ name: 'tool.call.toolview', key: 'zotero_search', locale: 'zotero' }),
      new Error('late'),
    )
    expect(world.reports).toHaveLength(0)
  })

  it('reports through the ctx it was handed, not a module-level singleton', async () => {
    const first = intakeWorld([])
    const second = intakeWorld([])
    await mountIntake(first)
    await mountIntake(second)

    first.crash(
      'conversation.view',
      storedEntry({ name: 'conversation.view', id: 'zotero', locale: 'zotero' }),
      new Error('one'),
      {
        abdicated: false,
      },
    )
    second.crash(
      'conversation.view',
      storedEntry({ name: 'conversation.view', id: 'zotero', locale: 'zotero' }),
      new Error('two'),
      {
        abdicated: false,
      },
    )
    await Promise.resolve()

    // Each mounted half reports into its own namespace: two plugin instances on
    // one page cannot cross their crash streams the way a singleton would, and
    // an unmounting half cannot clear the other's intake.
    expect(first.reports.map((report) => report.message)).toEqual(['one'])
    expect(second.reports.map((report) => report.message)).toEqual(['two'])
  })
})
