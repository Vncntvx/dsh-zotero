/**
 * Zotero settings, browser half: one surface over the `zotero` namespace,
 * rendered in the plugin manager detail page (`plugins.bundle.config`), carrying
 * the full configuration form so a namespace this wide is never read through
 * a collapsed card.
 *
 * The page reads and writes the `zotero` namespace through the harness's
 * shared configuration form (`ctx.configForms.get`), the seam that serves
 * every registered namespace, staged through the harness's own
 * `SettingsFormModel` (stage locally, write atomically on save, mark
 * user-layer presence as overridden). The Typert Remote namespace carries
 * only the live connectivity probe the dedicated conversation tab renders.
 * The namespace spelling comes from the shared settings-namespace module, so
 * the two halves cannot drift apart.
 * @module dsh-zotero/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only Context merges: locale (ctx.locale) arrives through its package's
// client declaration; the Remote face (ctx.remote) through the api-remotes
// assembly; ui-settings supplies the `configForms` service; ui-renderer the
// `slots` registry. `useSession`/`useChat` (the conversation tab's session
// data) merge through ui-session and ui-chat. Cross-plugin collaboration
// rides services and slot declarations, never value imports (client bundle
// purity).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: the `conversation.view` SlotMap row (declared by the slot's
// owning package) must be in the program for the tab registration to type;
// `uiConversation` (the event registry the command-input projection uses)
// merges through the same package.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the `sidebarRight` service the tab's `openResource` reads to reveal
// resolved attachments in the right sidebar.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { zoteroCommandInputDefinition } from './zotero-command-input.ts'
import { ZoteroCommandInputView } from './ZoteroCommandInputView.tsx'
import { ZoteroCommandCard } from './ZoteroCommandCard.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ZoteroSettingsSection } from './ZoteroSettingsSection.tsx'
import { SourcesTab, type SourcesTabFace } from './components/SourcesTab.tsx'
import { ZOTERO_REMOTE } from './remote.ts'
import { getAttachmentResolver, setAttachmentResolver } from './actions/attachment-resolver.ts'
import {
  getErrorReporter,
  reportCrashedSurface,
  setErrorReporter,
} from './actions/error-reporter.ts'
import { ZoteroCardController } from './zotero-card-controller.ts'
import type { ZoteroProbeFace } from './components/plugin/faces.ts'
import {
  ZOTERO_REMOTE_PACKAGE,
  type ZoteroClientErrorReport,
  type ZoteroDiagnosticsView,
  type ZoteroStatusView,
} from '../contract.ts'
import { ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.ts'
import type {} from './plugin-slots.d.ts'
import { ZoteroActivationGuide } from './components/plugin/ZoteroActivationGuide.tsx'
import { ZoteroPluginDetailSection } from './components/plugin/ZoteroPluginDetailSection.tsx'
import { DiagnosticsCard } from './components/DiagnosticsCard.tsx'
import { registerZoteroToolviews } from './toolviews/index.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'zotero'

/**
 * Required services (cordis fiber inject): the shared configuration form plus
 * slots/locale/remote, the conversation event registry, and sidebarRight to
 * reveal resolved attachments in the right sidebar.
 *
 * `remote` is the gateway this plugin mounts its own namespace through
 * (`ctx.remote.$mount`). `remote.zotero` is deliberately **absent** here: a
 * fiber parks until every declared name resolves, and this plugin is what
 * creates that namespace, so naming it here would park the entry before it
 * could ever mount. The namespace is declared by the UI fiber instead:
 * `ctx.inject(['remote.zotero', …], registerUi)` in `apply`, the official
 * consumer form (`docs/cookbook/adding-a-remote-api.md`, mirrored by
 * `packages/experimental/client-ui-voice-input/src/client/mount.ts` and
 * `packages/experimental/client-ui-claude-code-mods/src/client/mount.ts`).
 */
export const inject = ['locale', 'slots', 'remote', 'configForms', 'uiConversation', 'sidebarRight']

/**
 * The registrant stamped on every slot entry this plugin registers.
 *
 * The renderer stamps `options.registrant ?? ctx.fiber?.name` onto each entry
 * (`packages/client/ui-renderer/src/client/registry.ts`), so the field is the
 * harness's own answer to "who registered this". Declaring it explicitly here
 * rather than relying on the fiber-name fallback keeps ownership a value this
 * plugin controls: a fiber rename upstream must not silently change which
 * crashes the intake below claims.
 */
const REGISTRANT = ZOTERO_REMOTE_PACKAGE

/**
 * Whether one crashed registration belongs to dsh-zotero.
 *
 * Ownership is read from the registrant stamp, never inferred from key or name
 * substrings: a foreign registration that merely mentions "zotero" would
 * otherwise pollute the Zotero diagnostics ring, and an own registration whose
 * key carries no "zotero" would be silently dropped. A Factory occurrence
 * crash names the factory rather than a registrant, and the seam spells its key
 * `factory:<name>` (`SlotCore.reportFactoryError`), so a non-object
 * registration falls back to that key shape.
 */
function isZoteroRegistration(key: string, registration: unknown): boolean {
  if (registration !== null && typeof registration === 'object') {
    const registrant = (registration as { registrant?: unknown }).registrant
    if (registrant === REGISTRANT) return true
  }
  return key.startsWith('factory:')
}

/**
 * Register every browser surface: the page dictionaries, the 16 dedicated
 * tool cards, the `/zotero` command-input projection, the bundle configuration
 * page, the plugin-manager cards, and the conversation tab.
 *
 * Runs on a fiber that declares `remote.zotero`, so the namespace is readable
 * through the official dotted form (`ctx.remote.zotero`), the same shape the
 * harness's own client plugins use.
 * @param ctx - the browser plugin context, scoped to the declared services.
 */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-zotero: page dictionaries')
  ctx.effect(() => {
    const resolver = (ref: string) => ctx.remote.zotero.resolveAttachment(ref)
    setAttachmentResolver(resolver)
    return () => {
      if (getAttachmentResolver() === resolver) {
        setAttachmentResolver(undefined)
      }
    }
  }, 'dsh-zotero: attachment resolver')
  const reporter = (report: ZoteroClientErrorReport) => ctx.remote.zotero.reportClientError(report)
  ctx.effect(() => {
    setErrorReporter(reporter)
    return () => {
      if (getErrorReporter() === reporter) {
        setErrorReporter(undefined)
      }
    }
  }, 'dsh-zotero: error reporter')
  // Crash intake: the slot registry's own supervision seam, which the renderer
  // fires for every crashed entry (render throws and `inject` factory throws,
  // ordinary Slots and Factory occurrences alike). Filtered to our own
  // registrations so foreign failures never pollute the Zotero diagnostics
  // ring. The plugin's own render boundaries contain their crashes inside the
  // harness's `SlotErrorBoundary`, so the two channels see disjoint sets: this
  // one is the only path for a crash no boundary of ours ran for.
  ctx.effect(
    () =>
      ctx.slots.onEntryError((key, registration, error, info) => {
        if (!isZoteroRegistration(key, registration)) return
        reportCrashedSurface(key, error, { kind: 'slotEntry', abdicated: info.abdicated }, reporter)
      }),
    'dsh-zotero: slot crash intake',
  )
  // Dedicated Chat cards for all 16 Zotero tools in the tool.call.toolview slot
  registerZoteroToolviews(ctx)
  // `/zotero` command-input projection: a non-command Chat node is the
  // designed way for a slash command to leave the blank Hero (see ui-goal's
  // `command-input`). Without it, `command/run`+`command/done` log on a fresh
  // session while the shell stays blank and the status result is invisible.
  ctx.effect(
    () => ctx.uiConversation.events.register(zoteroCommandInputDefinition),
    'dsh-zotero: zotero command-input projection',
  )
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.node',
        key: 'zotero-command-input',
        locale: NS,
        registrant: REGISTRANT,
      },
      ZoteroCommandInputView,
    ),
  )
  // The shared form for the namespace the host half registers; the card
  // stages and saves through it with the harness's own staged model. The
  // entry declares only its own dependency (`webEnabled` for the tab gate);
  // the card form owns the full field table through `ZoteroCardController`
  // (which reads the same form as a record), so the narrow type is the
  // entry's read contract, not a truncation of the stored document.
  const form = ctx.configForms.get<Record<string, unknown>>(ZOTERO_SETTINGS_NAMESPACE)
  const card = new ZoteroCardController(form)
  ctx.effect(
    () => () => {
      card.dispose()
    },
    'dsh-zotero: card form',
  )
  // Bound once at registration time: the inject faces below hand this reader
  // to the shell, which re-renders from its own ledger bump when the locale
  // changes rather than subscribing to the namespace.
  const t = ctx.locale.bind(NS)
  // Live connectivity for the conversation tab's status strip. This fiber is
  // only created once `$mount` published the namespace, so the call site reads
  // it directly. Concurrent probes share one in-flight call: the strip and the
  // command card can both ask in the same tick, and one status read per tick
  // is the product behavior, not a workaround.
  let inFlightProbe: Promise<RemoteResult<ZoteroStatusView>> | undefined
  const probe = (): Promise<RemoteResult<ZoteroStatusView>> => {
    if (inFlightProbe !== undefined) return inFlightProbe
    const task = ctx.remote.zotero.status().finally(() => {
      if (inFlightProbe === task) inFlightProbe = undefined
    })
    inFlightProbe = task
    return task
  }

  // Guidance modal on plugin activation (plugins.bundle.activation)
  ctx.slots.inject('plugins.bundle.activation', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.activation',
        key: ZOTERO_REMOTE_PACKAGE,
        registrant: REGISTRANT,
        inject: (): ZoteroProbeFace => ({ t, probe }),
      },
      ZoteroActivationGuide,
    ),
  )

  // Bundle configuration rendered in the plugin manager detail page (plugins.bundle.config).
  // The page renders the full configuration form via ZoteroSettingsSection and stages
  // edits through the harness's SettingsFormModel (card.inject()).
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        key: ZOTERO_REMOTE_PACKAGE,
        locale: NS,
        registrant: REGISTRANT,
        inject: () => card.inject(),
      },
      ZoteroSettingsSection,
    ),
  )

  // Service status & quick start card at the bottom of the plugin manager detail page
  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register(
      {
        name: 'plugins.detail.section',
        id: 'zotero-status',
        registrant: REGISTRANT,
        inject: (): ZoteroProbeFace => ({ t, probe }),
      },
      ZoteroPluginDetailSection,
    ),
  )

  // The diagnostics panel, beside the status card: the host ring the seams
  // write, polled while the page shows it. It lives in the settings plane so
  // it survives the conversation tab's own crashes.
  const diagnostics = (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
    ctx.remote.zotero.diagnostics()
  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register(
      {
        name: 'plugins.detail.section',
        id: 'zotero-diagnostics',
        registrant: REGISTRANT,
        inject: () => ({ t, probe, diagnostics }),
      },
      DiagnosticsCard,
    ),
  )

  // Dedicated Slash command result card for `/zotero`
  ctx.slots.inject('conversation.chat.commandview', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.commandview',
        key: 'zotero',
        locale: NS,
        registrant: REGISTRANT,
        inject: () => ({ probe }),
      },
      ZoteroCommandCard,
    ),
  )

  // The dedicated Sources panel (a conversation tab) registers unless the
  // `webEnabled` namespace flag is explicitly off; before the first snapshot
  // the tab stays on, so a config hiccup never blocks it. The gate is live:
  // toggling the flag in the page hides or restores the tab without a reload.
  let tabDispose: (() => void) | undefined
  const tabT = ctx.locale.bind(NS)
  const sync = (): void => {
    const snapshot = form.getSnapshot()
    const enabled = snapshot.status !== 'ready' || snapshot.value?.webEnabled !== false
    if (enabled && tabDispose === undefined) {
      tabDispose = ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'zotero',
            order: 30,
            locale: NS,
            registrant: REGISTRANT,
            label: () => tabT('nav'),
            // Read through the mutable binding, so a probe that arrives after
            // the tab was mounted is the one the strip actually calls.
            inject: (): SourcesTabFace => ({
              status: () => probe(),
              resolveAttachment: (ref: string) => ctx.remote.zotero.resolveAttachment(ref),
              // The tab owns the Session identity and the workspace root it
              // resolves against (`useSessions`), so it builds the whole
              // address and hands the entry a ready URL. This fiber cannot do
              // it: on the browser side the `ctx.sessions` Context key carries
              // the host `SessionStore`, not the client `ISessions` catalog.
              openResource: (url: string) => ctx.sidebarRight.openResource(url),
            }),
          },
          SourcesTab,
        ),
      )
    } else if (!enabled && tabDispose !== undefined) {
      tabDispose()
      tabDispose = undefined
    }
  }
  ctx.effect(() => {
    const unsubscribe = form.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      tabDispose?.()
      tabDispose = undefined
    }
  }, 'dsh-zotero: conversation tab')
}

/**
 * Mount the Zotero Remote namespace and register every browser surface that
 * reads it.
 *
 * The two steps are ordered and one owns the other: `$mount` publishes
 * `remote.zotero`, then the UI fiber declares that name and is parked until it
 * resolves. An assembly failure is **not** swallowed: a mount that rejects, or
 * a namespace that never appears, rejects this entry and the harness reports
 * the plugin as failed to load, because a browser half whose status strip can
 * never answer is not a working plugin. That is the official contract
 * (`docs/cookbook/adding-a-remote-api.md`: "a Remote call does not reject, and
 * an assembly mistake should crash"), and the shape
 * `packages/experimental/client-ui-voice-input/src/client/mount.ts:63-67` and
 * `packages/experimental/client-ui-claude-code-mods/src/client/mount.ts:117-131`
 * both take.
 *
 * Disposal is symmetric and reverse-ordered: the UI fiber withdraws the slots
 * and effects it registered, then the namespace is unmounted.
 * @param ctx - the browser plugin context.
 * @returns the disposer that withdraws both halves.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(ZOTERO_REMOTE)
  const ui = ctx.inject(
    ['remote.zotero', 'locale', 'slots', 'configForms', 'uiConversation', 'sidebarRight'],
    registerUi,
  )
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
