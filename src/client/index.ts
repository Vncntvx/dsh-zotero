/**
 * Zotero settings, browser half: one surface over the `zotero` namespace,
 * a page in the harness's Settings panel's left navigation
 * (`settings.section`, a sibling of General, Models, and Plugins), carrying
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
// assembly; ui-settings supplies the `configForms` service and the
// `settings.section` SlotMap row this page registers into; ui-renderer the
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
import { zoteroCommandInputDefinition } from './zotero-command-input.ts'
import { ZoteroCommandInputView } from './ZoteroCommandInputView.tsx'
import { ZoteroCommandCard } from './ZoteroCommandCard.tsx'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { ZoteroSettingsSection } from './ZoteroSettingsSection.tsx'
import { SourcesTab, type SourcesTabFace } from './components/SourcesTab.tsx'
import { ZOTERO_REMOTE } from './remote.ts'

import { ZoteroCardController } from './zotero-card-controller.ts'
import { zoteroQuickConfigFace, type ZoteroProbeFace } from './components/plugin/faces.ts'
import { ZOTERO_REMOTE_PACKAGE, type ZoteroStatusView } from '../contract.ts'
import { ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.ts'
import type {} from './plugin-slots.d.ts'
import { ZoteroActivationGuide } from './components/plugin/ZoteroActivationGuide.tsx'
import { ZoteroBundleQuickConfig } from './components/plugin/ZoteroBundleQuickConfig.tsx'
import { ZoteroPluginDetailSection } from './components/plugin/ZoteroPluginDetailSection.tsx'
import { registerZoteroToolviews } from './toolviews/index.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'zotero'

/**
 * Required services (cordis fiber inject): the shared configuration form plus
 * slots/locale/remote and the conversation event registry.
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
export const inject = ['locale', 'slots', 'remote', 'configForms', 'uiConversation']

/**
 * Register every browser surface: the page dictionaries, the 16 dedicated
 * tool cards, the `/zotero` command-input projection, the settings page, the
 * plugin-manager cards, and the conversation tab.
 *
 * Runs on a fiber that declares `remote.zotero`, so the namespace is readable
 * through the official dotted form (`ctx.remote.zotero`), the same shape the
 * harness's own client plugins use.
 * @param ctx - the browser plugin context, scoped to the declared services.
 */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-zotero: page dictionaries')
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
  // The nav label is shell chrome, so it is read through a bound reader at
  // registration time (the shell re-renders from the ledger bump when the
  // locale changes, not from its own subscription).
  const t = ctx.locale.bind(NS)

  // The configuration page: one left-nav entry in the Settings panel, beside
  // General, Models, and Plugins. The shell renders the nav label from these
  // options and mounts the page in its content column; `slots.inject` waits
  // for the settings shell's declaration of `settings.section`, so the page
  // survives shell reloads and vanishes atomically with this fiber. Order 25
  // places it after the shipped sections this build registers (account -10,
  // general 0, models 10, plugins 15, agent-presets 20) and before any
  // higher-numbered contributor.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'zotero',
        order: 25,
        label: () => t('nav'),
        locale: NS,
        inject: () => card.inject(),
      },
      ZoteroSettingsSection,
    ),
  )

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
        inject: (): ZoteroProbeFace => ({ t, probe }),
      },
      ZoteroActivationGuide,
    ),
  )

  // Quick toggles in the plugin manager detail page (plugins.bundle.config).
  // The shared form is published as the face's bare observable source, so the
  // renderer binds `useZoteroQuickConfig` from the one form the settings page
  // and the card also edit, with no mirror snapshot to keep in step.
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        key: ZOTERO_REMOTE_PACKAGE,
        inject: () => zoteroQuickConfigFace(form, t),
      },
      ZoteroBundleQuickConfig,
    ),
  )

  // Service status & quick start card at the bottom of the plugin manager detail page
  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register(
      {
        name: 'plugins.detail.section',
        id: 'zotero-status',
        inject: (): ZoteroProbeFace => ({ t, probe }),
      },
      ZoteroPluginDetailSection,
    ),
  )

  // Dedicated Slash command result card for `/zotero`
  ctx.slots.inject('conversation.chat.commandview', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.commandview',
        key: 'zotero',
        locale: NS,
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
            label: () => tabT('nav'),
            // Read through the mutable binding, so a probe that arrives after
            // the tab was mounted is the one the strip actually calls.
            inject: (): SourcesTabFace => ({ status: () => probe() }),
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
    ['remote.zotero', 'locale', 'slots', 'configForms', 'uiConversation'],
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
