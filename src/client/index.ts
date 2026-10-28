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
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
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
import { ScholarlySettingsSection } from './ScholarlySettingsSection.tsx'
import { SourcesTab, type SourcesTabFace } from './components/SourcesTab.tsx'
import { ZOTERO_REMOTE } from './remote.ts'
import { getAttachmentResolver, setAttachmentResolver } from './actions/attachment-resolver.ts'
import {
  getErrorReporter,
  reportCrashedSurface,
  setErrorReporter,
} from './actions/error-reporter.ts'
import { ZoteroCardController } from './zotero-card-controller.ts'
import { ScholarlyFormController } from './scholarly-form-controller.ts'
import { LibraryFormController } from './library-form-controller.ts'
import type { ZoteroProbeFace } from './components/plugin/faces.ts'
import {
  ZOTERO_LIBRARY_SETTINGS_NAMESPACE,
  ZOTERO_REMOTE_PACKAGE,
  type ZoteroClientErrorReport,
  type ZoteroDiagnosticsView,
  type ZoteroStatusView,
} from '../contract.ts'
import { SCHOLARLY_SETTINGS_NAMESPACE, ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.ts'
import type {} from './plugin-slots.d.ts'
import { ZoteroActivationGuide } from './components/plugin/ZoteroActivationGuide.tsx'
import { ZoteroPluginDetailSection } from './components/plugin/ZoteroPluginDetailSection.tsx'
import { DiagnosticsCard } from './components/DiagnosticsCard.tsx'
import { LibrarySettingsSection } from './LibrarySettingsSection.tsx'
import {
  ZoteroLibraryPanel,
  type ZoteroLibraryPanelFace,
} from './components/library/ZoteroLibraryPanel.tsx'
import { createLibraryDataPlane } from './components/library/library-data-plane.ts'
import { ZoteroLibraryIcon } from './components/library/ZoteroLibraryIcon.tsx'
import { gatedMount, registerGatedSurfaces, watchWebEnabled, webEnabledOf } from './web-enabled.ts'
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
export const inject = [
  'locale',
  'slots',
  'remote',
  'configForms',
  'uiConversation',
  'sidebarRight',
  'sidebarRightTabs',
]

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
 * key carries no "zotero" would be silently dropped. Ownership is governed
 * strictly by the registrant stamp matching REGISTRANT.
 */
function isZoteroRegistration(_key: string, registration: unknown): boolean {
  if (registration !== null && typeof registration === 'object') {
    const registrant = (registration as { registrant?: unknown }).registrant
    if (registrant === REGISTRANT) return true
  }
  return false
}

/**
 * The cross-surface facts every registration group reads: one shared probe
 * (concurrent callers join the in-flight read) and the two settings forms.
 */
interface UiSurfaces {
  readonly form: ConfigForm<Record<string, unknown>>
  readonly card: ZoteroCardController
  readonly scholarlyCard: ScholarlyFormController
  readonly libraryForm: ConfigForm<Record<string, unknown>>
  readonly libraryCard: LibraryFormController
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

/**
 * The fiber-wide effects every surface group builds on: the page
 * dictionaries, the attachment-resolver and error-reporter bridges, the slot
 * crash intake, and the dedicated tool cards.
 */
function registerSharedSurfaces(ctx: ClientContext): void {
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
  // Dedicated Chat cards for the registered Zotero and cross-component tools
  registerZoteroToolviews(ctx)
}

/**
 * The plugin-manager surfaces: the activation guide, the bundle configuration
 * page, the scholarly row configuration, and the status/diagnostics cards.
 * Every registration below declares `locale: NS` and reads its `t` from the
 * renderer's synthesized seat: the framework mints a fresh reference per
 * locale revision, so a switch re-renders these cards through ordinary
 * shallow comparison, and a declared namespace with no installed locale face
 * fails the assembly loudly instead of silently falling back
 * (`ui-renderer/src/client/scoped-slots.tsx`).
 */
function registerPluginManagerSurfaces(ctx: ClientContext, surfaces: UiSurfaces): void {
  const { card, scholarlyCard, libraryCard, probe } = surfaces
  // Guidance modal on plugin activation (plugins.bundle.activation)
  ctx.slots.inject('plugins.bundle.activation', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.activation',
        key: ZOTERO_REMOTE_PACKAGE,
        locale: NS,
        registrant: REGISTRANT,
        inject: (): ZoteroProbeFace => ({ probe }),
      },
      ZoteroActivationGuide,
    ),
  )

  // Bundle configuration on the plugin manager detail page (plugins.bundle.config).
  // The page renders the unified 6-tab form through ZoteroSettingsSection and stages edits
  // over zotero, scholarly, and library namespaces.
  ctx.slots.inject('plugins.bundle.config', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        key: ZOTERO_REMOTE_PACKAGE,
        locale: NS,
        registrant: REGISTRANT,
        inject: () => {
          const zoteroFace = card.inject()
          const scholarlyFace = scholarlyCard.inject()
          const libraryFace = libraryCard.inject()
          return {
            ...zoteroFace,
            hooks: {
              zoteroCard: zoteroFace.hooks.zoteroCard,
              scholarlyCard: scholarlyFace.hooks.scholarlyCard,
              libraryCard: libraryFace.hooks.libraryCard,
            },
            scholarly: scholarlyFace,
            library: libraryFace,
          }
        },
      },
      ZoteroSettingsSection,
    ),
  )

  // Dedicated row configuration for the scholarly subsystem (plugins.row.config).
  // It opens from the "Configure" button on the dsh-zotero#scholarly row.
  // Guarded by whileServed so it registers only while the host serves the scholarly namespace.
  ctx.effect(
    () =>
      ctx.configForms.whileServed([SCHOLARLY_SETTINGS_NAMESPACE], () =>
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: `${ZOTERO_REMOTE_PACKAGE}#scholarly`,
              locale: NS,
              registrant: REGISTRANT,
              inject: () => scholarlyCard.inject(),
            },
            ScholarlySettingsSection,
          ),
        ),
      ),
    'dsh-zotero: scholarly row config',
  )

  // Dedicated row configuration for the library subsystem (plugins.row.config),
  // opened from the "Configure" button on the dsh-zotero#library row.
  // whileServed guards it to the host serving the library namespace.
  ctx.effect(
    () =>
      ctx.configForms.whileServed([ZOTERO_LIBRARY_SETTINGS_NAMESPACE], () =>
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: `${ZOTERO_REMOTE_PACKAGE}#library`,
              locale: NS,
              registrant: REGISTRANT,
              inject: () => libraryCard.inject(),
            },
            LibrarySettingsSection,
          ),
        ),
      ),
    'dsh-zotero: library row config',
  )

  // Service status & quick start card at the bottom of the plugin manager detail page
  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register(
      {
        name: 'plugins.detail.section',
        id: 'zotero-status',
        locale: NS,
        registrant: REGISTRANT,
        inject: (): ZoteroProbeFace => ({ probe }),
      },
      ZoteroPluginDetailSection,
    ),
  )

  // The diagnostics panel, beside the status card: the host ring the seams
  // write, polled while the page shows it. It lives in the settings plane so
  // it survives the conversation tab's own crashes. The card component renders
  // only when diagnostic mode (the `debug` config flag) is enabled.
  const diagnostics = (): Promise<RemoteResult<ZoteroDiagnosticsView>> =>
    ctx.remote.zotero.diagnostics()
  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register(
      {
        name: 'plugins.detail.section',
        id: 'zotero-diagnostics',
        locale: NS,
        registrant: REGISTRANT,
        inject: () => ({ probe, diagnostics }),
      },
      DiagnosticsCard,
    ),
  )
}

/**
 * The `/zotero` command-input surfaces: the projection that leaves the blank
 * Hero plus its chat node. Registered between the shared surfaces and the
 * plugin-manager cards, the order the registration contract pins.
 */
function registerCommandInputSurfaces(ctx: ClientContext): void {
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
}

/**
 * The conversation surfaces: the `/zotero` command result card and the
 * Sources panel gated by `webEnabled`.
 */
function registerConversationSurfaces(ctx: ClientContext, surfaces: UiSurfaces): void {
  const { form, probe } = surfaces

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
  const tabT = ctx.locale.bind(NS)
  registerGatedSurfaces(
    ctx,
    'dsh-zotero: conversation tab',
    (onChange) => watchWebEnabled(form, onChange),
    () => {
      return ctx.slots.inject('conversation.view', () =>
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
    },
  )
}

/**
 * Whether the library sidebar surface is enabled: the root `webEnabled` flag
 * (false only when the snapshot says so) and the surface's own switch.
 */
function sidebarEnabledOf(
  form: ConfigForm<Record<string, unknown>>,
  libraryForm: ConfigForm<Record<string, unknown>>,
  key: 'rightSidebarEnabled',
): boolean {
  const snapshot = libraryForm.getSnapshot()
  const ownSwitchOn = snapshot.status !== 'ready' || snapshot.value?.[key] !== false
  return webEnabledOf(form) && ownSwitchOn
}

/**
 * The library panel surface: the right `sidebarRightTabs` + `sidebar.right.pane.tab`
 * pair, gated by `rightSidebarEnabled` and the global `webEnabled` flag. The
 * panel lives beside the session on purpose: the right reader (local PDFs)
 * and the session composer (ask / add-to-chat) are session-adjacent seams the
 * main-column placement cannot reach.
 *
 * The panel is session-scoped (the pane tab binds to one conversation), so the
 * injected face carries everything it reads: the wire calls, the shared
 * connectivity probe, and the right-sidebar opener for local-file reading.
 * @param ctx - the browser plugin context.
 * @param surfaces - the shared facts every registration group reads.
 */
function registerLibraryPanelSurfaces(ctx: ClientContext, surfaces: UiSurfaces): void {
  const { form, libraryForm, probe } = surfaces
  const panelT = ctx.locale.bind(NS)

  /**
   * Both the reader and the chat actions rely on session-adjacent seams: the
   * harness opens resources into and prefills the draft of the on-screen
   * session's surfaces, which this placement (mounted beside the session)
   * always is.
   */
  const plane = createLibraryDataPlane({
    browse: (request) => ctx.remote.zotero.browse(request),
    search: (request) => ctx.remote.zotero.search(request),
    item: (request) => ctx.remote.zotero.item(request),
    childPage: (request) => ctx.remote.zotero.childPage(request),
  })
  const panelFace = (): ZoteroLibraryPanelFace => ({
    status: () => probe(),
    browse: (request) => plane.browse(request),
    search: (request) => plane.search(request),
    item: (request) => plane.item(request),
    childPage: (request) => plane.childPage(request),
    invalidate: plane.invalidate,
    setInstance: plane.setInstance,
    write: (request) => ctx.remote.zotero.write(request),
    resolveAttachment: (ref: string) => ctx.remote.zotero.resolveAttachment(ref),
    openResource: (url: string) => ctx.sidebarRight.openResource(url),
  })

  const mountRight = (): (() => void) => {
    const TAB_ID = `${ZOTERO_REMOTE_PACKAGE}#library`
    const TAB_KIND = 'zotero-library'

    const disposeTabDef = ctx.sidebarRightTabs?.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => panelT('tabLibrary'),
      guide: [
        {
          id: 'zotero-library-guide',
          order: 25,
          title: () => panelT('tabLibrary'),
          description: () => panelT('tabLibraryDesc'),
          icon: ZoteroLibraryIcon,
        },
      ],
    })

    const disposeTabBody = ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
          registrant: REGISTRANT,
          inject: panelFace,
        },
        ZoteroLibraryPanel,
      ),
    )

    const disposeTabTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.pane.tab.title',
          key: TAB_ID,
          locale: NS,
          registrant: REGISTRANT,
        },
        () => panelT('tabLibrary'),
      ),
    )

    return () => {
      disposeTabTitle()
      disposeTabBody()
      disposeTabDef?.()
    }
  }

  // The `library` settings namespace is served exactly while the
  // `dsh-zotero/library` row is composed; with the row off, no surface
  // registers and no `zotero/browse|search|item|write` call is made.
  ctx.effect(
    () =>
      ctx.configForms.whileServed([ZOTERO_LIBRARY_SETTINGS_NAMESPACE], () => {
        const right = gatedMount(mountRight)
        const sync = (): void => {
          right.sync(sidebarEnabledOf(form, libraryForm, 'rightSidebarEnabled'))
        }
        const unsubscribeForm = form.subscribe(sync)
        const unsubscribeLibrary = libraryForm.subscribe(sync)
        sync()
        return () => {
          unsubscribeForm()
          unsubscribeLibrary()
          right.dispose()
        }
      }),
    'dsh-zotero: library right-sidebar surface',
  )
}

/**
 * Register every browser surface: the page dictionaries, the dedicated
 * tool cards, the `/zotero` command-input projection, the bundle configuration
 * page, the plugin-manager cards, and the conversation tab.
 *
 * Runs on a fiber that declares `remote.zotero`, so the namespace is readable
 * through the official dotted form (`ctx.remote.zotero`), the same shape the
 * harness's own client plugins use.
 * @param ctx - the browser plugin context, scoped to the declared services.
 */
function registerUi(ctx: ClientContext): void {
  registerSharedSurfaces(ctx)
  registerCommandInputSurfaces(ctx)
  // One form controller per settings namespace. The bundle configuration page
  // edits all three at once; the dedicated rows edit their specific subsystem.
  // All live as long as the client fiber.
  const form = ctx.configForms.get<Record<string, unknown>>(ZOTERO_SETTINGS_NAMESPACE)
  const scholarlyForm = ctx.configForms.get<Record<string, unknown>>(SCHOLARLY_SETTINGS_NAMESPACE)
  const libraryForm = ctx.configForms.get<Record<string, unknown>>(
    ZOTERO_LIBRARY_SETTINGS_NAMESPACE,
  )
  const card = new ZoteroCardController(form)
  const scholarlyCard = new ScholarlyFormController(scholarlyForm)
  const libraryCard = new LibraryFormController(libraryForm)

  ctx.effect(
    () => () => {
      card.dispose()
      scholarlyCard.dispose()
      libraryCard.dispose()
    },
    'dsh-zotero: card forms',
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
  const surfaces: UiSurfaces = {
    form,
    card,
    scholarlyCard,
    libraryForm,
    libraryCard,
    probe,
  }
  registerPluginManagerSurfaces(ctx, surfaces)
  registerConversationSurfaces(ctx, surfaces)
  registerLibraryPanelSurfaces(ctx, surfaces)
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
    [
      'remote.zotero',
      'locale',
      'slots',
      'configForms',
      'uiConversation',
      'sidebarRight',
      'sidebarRightTabs',
    ],
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
