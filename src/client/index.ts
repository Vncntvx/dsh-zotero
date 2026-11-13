import { ParsedDocuments } from './parsed-documents.ts'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import { ZoteroPdfRecoveryMenu } from './components/library/ZoteroPdfRecoveryMenu.tsx'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { createPdfReaderRegistry, type PdfReaderRegistry } from './url-pdf-readers.ts'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { createLibraryPreferenceSource } from './library-preferences.tsx'
import type { LibraryPreferenceSource } from './library-preferences.tsx'
import type { LibraryPreferences } from '../library-preferences.js'
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
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import {
  createDocumentParseSurface,
  type DocumentParseClientContext,
  type DocumentParseSurfacePort,
} from './enrichment/parse-surface.tsx'
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
// owning package) must be in the program for the tab registration to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
// Type-only: the `sidebarRight` service the tab's `openResource` reads to reveal
// resolved attachments in the right sidebar.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { ZoteroSettingsSection } from './ZoteroSettingsSection.tsx'
import { ScholarlySettingsSection } from './ScholarlySettingsSection.tsx'
import { EnrichmentSettingsSection } from './EnrichmentSettingsSection.tsx'
import { EnrichmentEnableNotice } from './enrichment/EnableNotice.tsx'
import { ScholarlyEnableNotice } from './scholarly/EnableNotice.tsx'
import {
  EnableNoticeArbiter,
  EnableNoticeController,
  ENRICHMENT_EGRESS_ACK_KEY,
  SCHOLARLY_RETRIEVAL_ACK_KEY,
  clientAcknowledgement,
} from './enable-notice.ts'
import { SourcesTab, type SourcesTabFace } from './components/SourcesTab.tsx'
import { ZOTERO_REMOTE } from './remote.ts'
import { createZoteroClientFace, type ZoteroClientFace } from './actions/client-face.ts'
import { reportCrashedSurface } from './actions/error-reporter.ts'
import { ZoteroCardController } from './zotero-card-controller.ts'
import { ScholarlyFormController } from './scholarly-form-controller.ts'
import type { ScholarlyCredentialPort } from './scholarly-form-controller.ts'
import { EnrichmentFormController } from './enrichment-form-controller.ts'
import type { EnrichmentCredentialPort, EnrichmentModelPort } from './enrichment-form-controller.ts'
import { LibraryFormController } from './library-form-controller.ts'
import { CitationFormController } from './citation-form-controller.ts'
import type { ZoteroProbeFace } from './components/plugin/faces.ts'
import {
  ZOTERO_LIBRARY_SETTINGS_NAMESPACE,
  ZOTERO_REMOTE_PACKAGE,
  type ZoteroDiagnosticsView,
  type ZoteroStatusView,
} from '../contract.ts'
import {
  ENRICHMENT_SETTINGS_NAMESPACE,
  SCHOLARLY_SETTINGS_NAMESPACE,
  ZOTERO_SETTINGS_NAMESPACE,
} from '../settings-namespace.ts'
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
import { clearLibraryState } from './components/library/library-storage.ts'
import { createLibraryViewStore } from './components/library/library-view-store.ts'
import { LIBRARY_ICON_KEY, LIBRARY_TAB_KIND } from './library-tab.ts'
import { PARSED_TAB_KIND, PARSED_TAB_PATTERN, parsedTabAddress } from './parsed-tab.ts'
import {
  ParsedDocumentTab,
  ParsedDocumentTitle,
  type ParsedDocumentTabFace,
} from './components/library/ParsedDocumentTab.tsx'
import { ZoteroLibraryIcon } from './components/library/ZoteroLibraryIcon.tsx'
import { gatedMount, registerGatedSurfaces, watchWebEnabled } from './web-enabled.ts'
import { registerZoteroToolviews } from './toolviews/index.ts'
import { ZoteroLibraryMenu } from './components/library/ZoteroLibraryMenu.tsx'
import { ZoteroComposerSlot } from './components/composer/ZoteroComposerButton.tsx'
import { isBibliographyPath } from './bibliography.ts'
import { DeliverableZoteroAction } from './components/deliverables/DeliverableZoteroAction.tsx'
import { DocumentOpenLibraryAction } from './components/document/DocumentOpenLibraryAction.tsx'
import { ZoteroToast } from './components/ZoteroToast.tsx'
import { selectUrlOf } from './actions/open-zotero.ts'
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
  'remote.credentials',
  'remoteAccess',
  'configForms',
  'sidebarRight',
  'sidebarRightTabs',
  'resources',
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
  readonly enrichmentCard: EnrichmentFormController
  readonly libraryForm: ConfigForm<Record<string, unknown>>
  readonly libraryCard: LibraryFormController
  readonly citationCard: CitationFormController
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
  /** The one client face; root props and out-of-tree consumers read it here. */
  readonly client: ZoteroClientFace
  /**
   * The reading-file leases, shared by every surface that opens a PDF: the
   * registry owns the lease until the reader tab that holds the file closes.
   */
  readonly pdfReaders: PdfReaderRegistry
  /** The committed library preferences; the surfaces read them when they act. */
  readonly libraryPreferences: () => LibraryPreferences | undefined
  /** The one preference source; the panel publishes it through its context. */
  readonly preferenceSource: LibraryPreferenceSource
  readonly parse: DocumentParseSurfacePort
  readonly parsedDocuments: ParsedDocuments
}

/**
 * The fiber-wide effects every surface group builds on: the page
 * dictionaries, the shared client face, the protocol-failure toast, the slot
 * crash intake, and the dedicated tool cards.
 */
function registerSharedSurfaces(ctx: ClientContext, surfaces: UiSurfaces): void {
  const { client } = surfaces
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-zotero: page dictionaries')
  ctx.effect(
    () => ctx.slots.provideRoot({ props: { useZoteroClient: () => client } }),
    'dsh-zotero: client face',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'zotero.protocol-toast',
            locale: NS,
            registrant: REGISTRANT,
            inject: () => ({
              hooks: { toast: client.protocolNotice },
              dismiss: client.dismissProtocolNotice,
            }),
          },
          ZoteroToast,
        ),
      ),
    'dsh-zotero: protocol toast',
  )
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
        reportCrashedSurface(
          key,
          error,
          { kind: 'slotEntry', abdicated: info.abdicated },
          client.reportClientError,
        )
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
  const { card, scholarlyCard, enrichmentCard, libraryCard, citationCard, probe } = surfaces
  // Enabling dsh-zotero/enrichment accepts MinerU document egress, and
  // enabling dsh-zotero/scholarly authorizes external scholarly retrieval, so
  // the client owes the user a disclosure whenever a component is served and
  // this browser has not acknowledged the current enable — a deployment
  // already enabled at boot included. The acknowledgement covers one enable
  // period and is revoked when the component is observed off, so turning it off
  // and on again asks once more. One arbiter shows the two disclosures in
  // registration order instead of stacking two modals. The overlays live on
  // the shell rather than the settings page, so a disclosure can appear
  // wherever the switch was flipped.
  const noticeArbiter = new EnableNoticeArbiter()
  const enrichmentNotice = new EnableNoticeController(
    enrichmentCard.inject().hooks.enrichmentCard,
    'enrichmentEnableNotice',
    clientAcknowledgement(ENRICHMENT_EGRESS_ACK_KEY),
    noticeArbiter,
  )
  const scholarlyNotice = new EnableNoticeController(
    scholarlyCard.inject().hooks.scholarlyCard,
    'scholarlyEnableNotice',
    clientAcknowledgement(SCHOLARLY_RETRIEVAL_ACK_KEY),
    noticeArbiter,
  )
  ctx.effect(
    () => () => {
      enrichmentNotice.dispose()
      scholarlyNotice.dispose()
    },
    'dsh-zotero: enable notice state',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'zotero.enrichment-enable-notice',
            locale: NS,
            registrant: REGISTRANT,
            inject: () => enrichmentNotice.inject(),
          },
          EnrichmentEnableNotice,
        ),
      ),
    'dsh-zotero: enrichment enable notice',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'zotero.scholarly-enable-notice',
            locale: NS,
            registrant: REGISTRANT,
            inject: () => scholarlyNotice.inject(),
          },
          ScholarlyEnableNotice,
        ),
      ),
    'dsh-zotero: scholarly enable notice',
  )
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
  // The page renders the unified 7-tab form through ZoteroSettingsSection and stages edits
  // over zotero, scholarly, library, and enrichment namespaces.
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
          const enrichmentFace = enrichmentCard.inject()
          const libraryFace = libraryCard.inject()
          const citationFace = citationCard.inject()
          return {
            ...zoteroFace,
            probe,
            revokeWriteGrant: () => ctx.remote.zotero.revokeWriteGrant(),
            hooks: {
              zoteroCard: zoteroFace.hooks.zoteroCard,
              scholarlyCard: scholarlyFace.hooks.scholarlyCard,
              enrichmentCard: enrichmentFace.hooks.enrichmentCard,
              libraryCard: libraryFace.hooks.libraryCard,
              citationCard: citationFace.hooks.citationCard,
            },
            scholarly: scholarlyFace,
            enrichment: enrichmentFace,
            library: libraryFace,
            citation: citationFace,
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

  // Dedicated row configuration for the enrichment subsystem (plugins.row.config),
  // opened from the "Configure" button on the dsh-zotero#enrichment row. It covers
  // the free/pro switch, the MinerU token, and the output dir.
  // whileServed guards it to the host serving the enrichment namespace (the row is
  // disabled by default), so the row shows no config while the component is off.
  ctx.effect(
    () =>
      ctx.configForms.whileServed([ENRICHMENT_SETTINGS_NAMESPACE], () =>
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: `${ZOTERO_REMOTE_PACKAGE}#enrichment`,
              locale: NS,
              registrant: REGISTRANT,
              inject: () => enrichmentCard.inject(),
            },
            EnrichmentSettingsSection,
          ),
        ),
      ),
    'dsh-zotero: enrichment row config',
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
              inject: () => {
                const library = libraryCard.inject()
                const citation = citationCard.inject()
                return {
                  ...library,
                  citation,
                  hooks: { ...library.hooks, ...citation.hooks },
                }
              },
            },
            LibrarySettingsSection,
          ),
        ),
      ),
    'dsh-zotero: library row config',
  )

  // Service status section at the bottom of the plugin manager detail page
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
 * The conversation surfaces: the Sources panel gated by `webEnabled`.
 */
function registerConversationSurfaces(ctx: ClientContext, surfaces: UiSurfaces): void {
  const { form, probe } = surfaces

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
              exportCitation: (request) => ctx.remote.zotero.export(request),
              sourcePage: (request) => ctx.remote.zotero.sourcePage(request),
              readUrlPdf: (request, signal) => ctx.remote.zotero.readUrlPdf(request, signal),
              releaseUrlPdf: (lease) =>
                ctx.remote.zotero.releaseUrlPdf({ lease }).then((result) => {
                  if (!result.ok) throw result.error
                }),
              trackPdf: surfaces.pdfReaders.track,
              forgetPdf: surfaces.pdfReaders.forget,
              libraryPreferences: surfaces.libraryPreferences,
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
 * Whether the library sidebar surface is enabled: the library namespace's own
 * switch, ready only once its snapshot arrives. `webEnabled` is not part of
 * this gate — it governs the literature trail, not the panel.
 */
function sidebarEnabledOf(
  libraryForm: ConfigForm<Record<string, unknown>>,
  key: 'rightSidebarEnabled',
): boolean {
  const snapshot = libraryForm.getSnapshot()
  return snapshot.status === 'ready' && snapshot.value?.[key] !== false
}

/**
 * The library panel surface: the right `sidebarRightTabs` + `sidebar.right.pane.tab`
 * pair, gated by the mounted component, `rightSidebarEnabled` and browse access. The
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
  const { libraryForm, probe, client, pdfReaders } = surfaces
  const preferenceSource = surfaces.preferenceSource
  const panelT = ctx.locale.bind(NS)

  // The panel's in-memory view cache: created with this registration and
  // released with it, so no entry outlives the plugin and two panels never
  // share one.
  const viewStore = createLibraryViewStore()
  ctx.effect(() => () => viewStore.dispose(), 'dsh-zotero: library view store')

  /**
   * Both the reader and the chat actions rely on session-adjacent seams: the
   * harness opens resources into and prefills the draft of the on-screen
   * session's surfaces, which this placement (mounted beside the session)
   * always is.
   */
  // The cancellation argument is passed only when the caller has one: the
  // wire treats it as optional, and a plane read started without a signal
  // stays a one-argument call all the way down.
  const forward =
    <Request, Result>(call: (request: Request, signal?: AbortSignal) => Promise<Result>) =>
    (request: Request, signal?: AbortSignal): Promise<Result> =>
      signal === undefined ? call(request) : call(request, signal)
  const plane = createLibraryDataPlane({
    collectionPath: forward(ctx.remote.zotero.collectionPath),
    browse: forward(ctx.remote.zotero.browse),
    search: forward(ctx.remote.zotero.search),
    item: forward(ctx.remote.zotero.item),
    childPage: forward(ctx.remote.zotero.childPage),
    export: forward(ctx.remote.zotero.export),
  })
  const refreshBindings = new Map<string, { refresh: () => void; clear: () => void }>()
  const refreshKey = (sessionId: string, tabId: string) => JSON.stringify([sessionId, tabId])
  const bindRefresh = (
    sessionId: string,
    tabId: string,
    refresh: () => void,
    clear: () => void,
  ) => {
    const key = refreshKey(sessionId, tabId)
    const binding = { refresh, clear }
    refreshBindings.set(key, binding)
    return () => {
      if (refreshBindings.get(key) === binding) refreshBindings.delete(key)
    }
  }
  const panelFace = (sessionId: SessionId): ZoteroLibraryPanelFace => ({
    viewStore,
    parse: surfaces.parse,
    // The parsed tab is address-claimed, so two attachments never share one
    // tab and reopening a document reveals it.
    openParsed: (attachment, title, itemRef) =>
      ctx.sidebarRight.openResourceIn(
        sessionId,
        parsedTabAddress({ sessionId, ref: attachment.ref, title: '' }),
        { params: { title: title || attachment.title, ...(itemRef ? { item: itemRef } : {}) } },
      ),
    preferenceSource,
    readUrlPdf: (request, signal) => ctx.remote.zotero.readUrlPdf(request, signal),
    releaseUrlPdf: (lease) =>
      ctx.remote.zotero.releaseUrlPdf({ lease }).then((result) => {
        if (!result.ok) throw result.error
      }),
    trackPdf: pdfReaders.track,
    forgetPdf: pdfReaders.forget,
    bindRefresh,
    status: () => probe(),
    collectionPath: (request, signal) => plane.collectionPath(request, signal),
    browse: (request, signal) => plane.browse(request, signal),
    search: (request, signal) => plane.search(request, signal),
    item: (request, signal) => plane.item(request, signal),
    childPage: (request, signal) => plane.childPage(request, signal),
    invalidate: plane.invalidate,
    setInstance: plane.setInstance,
    export: (request) => plane.export(request),
    write: (request) => ctx.remote.zotero.write(request),
    resolveAttachment: (ref: string) => ctx.remote.zotero.resolveAttachment(ref),
    openResource: (url: string) => ctx.sidebarRight.openResource(url),
  })

  const mountRight = (): (() => void) => {
    const TAB_ID = `${ZOTERO_REMOTE_PACKAGE}#library`
    const openLibraryFace = (): { onOpenLibrary: () => void } => ({
      onOpenLibrary: () => ctx.sidebarRight.openTab(LIBRARY_TAB_KIND),
    })

    const disposeTabDef = ctx.sidebarRightTabs.register({
      id: TAB_ID,
      kind: LIBRARY_TAB_KIND,
      title: () => panelT('tabLibrary'),
      guide: [
        {
          id: 'zotero-library-guide',
          order: 25,
          title: () => panelT('libraryGuideTitle'),
          description: () => panelT('libraryGuideDesc'),
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

    // One parsed document per tab: the attachment rides the address, so a
    // second open reveals the same tab. Registered only while enrichment
    // serves a document reader.
    const PARSED_TAB_ID = `${ZOTERO_REMOTE_PACKAGE}#parsed`
    const disposeParsedTab = ctx.effect(() => {
      const parse = surfaces.parse
      if (parse === undefined) return () => {}
      const parsedFace = (): ParsedDocumentTabFace => ({
        refresh: (address) => surfaces.parsedDocuments.refresh(address),
        // The explain request cites the item, so the model can read the rest
        // of the paper through the read tools.
        item: (request, signal) => ctx.remote.zotero.item(request, signal),
        parse,
      })
      const disposeType = ctx.sidebarRightTabs.register({
        id: PARSED_TAB_ID,
        kind: PARSED_TAB_KIND,
        patterns: [PARSED_TAB_PATTERN],
        // The chip names the paper itself: no synthetic prefix, no suffix.
        title: () => panelT('tabParsedFallback'),
      })
      const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: PARSED_TAB_ID,
            locale: NS,
            registrant: REGISTRANT,
            inject: parsedFace,
          },
          ParsedDocumentTab,
        ),
      )
      const disposeTitle = ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab.title',
            key: PARSED_TAB_ID,
            locale: NS,
            registrant: REGISTRANT,
          },
          ParsedDocumentTitle,
        ),
      )
      return () => {
        disposeTitle()
        disposeBody()
        disposeType()
      }
    })

    const disposeTabMenu = ctx.slots.inject('sidebar.right.tab.menu.item', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.tab.menu.item',
          id: `${REGISTRANT}.library.menu`,
          order: 200,
          locale: NS,
          registrant: REGISTRANT,
          inject: () => ({
            onClear: async (sessionId: string, tabId: string) => {
              const binding = refreshBindings.get(refreshKey(sessionId, tabId))
              if (binding) {
                binding.clear()
                return
              }
              const status = await probe()
              if (!status.ok) throw status.error
              if (!status.value.serverId) throw new Error(panelT('libraryOffline'))
              clearLibraryState(status.value.serverId, sessionId)
              viewStore.clearView(status.value.serverId, sessionId)
            },
            onRefresh: (sessionId: string, tabId: string) => {
              const refresh = refreshBindings.get(refreshKey(sessionId, tabId))
              if (refresh) refresh.refresh()
              else plane.invalidate()
            },
          }),
        },
        ZoteroLibraryMenu,
      ),
    )

    const disposePdfRecovery = ctx.effect(() =>
      ctx.remoteAccess.whenAccess('zotero/readUrlPdf', () =>
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.tab.menu.item',
              id: `${REGISTRANT}.pdf.recovery`,
              order: 210,
              locale: NS,
              registrant: REGISTRANT,
              inject: () => ({
                source: pdfReaders.source,
                recoveryError: pdfReaders.recoveryError,
                reload: async (sessionId: string, tabId: string, address: string) => {
                  const ref = pdfReaders.source(address)
                  if (!ref) throw new Error(panelT('libraryPdfSourceMissing'))
                  if (!preferenceSource.getSnapshot().preferences?.allowUrlPdfRead)
                    throw new Error(panelT('libraryUrlPdfDisabled'))
                  const controller = new AbortController()
                  const present = () =>
                    ctx.sidebarRight.openTabs
                      .getSnapshot()
                      .some(
                        (tab) =>
                          tab.sessionId === sessionId &&
                          tab.tabId === tabId &&
                          tab.contentId === address,
                      )
                  const unsubscribe = ctx.sidebarRight.openTabs.subscribe(() => {
                    if (!present()) controller.abort(new Error('PDF tab closed.'))
                  })
                  try {
                    if (!present()) throw new Error('PDF tab closed.')
                    const result = await ctx.remote.zotero.readUrlPdf({ ref }, controller.signal)
                    if (!result.ok) throw new Error(result.error.message)
                    try {
                      controller.signal.throwIfAborted()
                      const occurrence = ctx.sidebarRight.openTabs
                        .getSnapshot()
                        .find(
                          (tab) =>
                            tab.sessionId === sessionId &&
                            tab.tabId === tabId &&
                            tab.contentId === address,
                        )
                      if (!occurrence) throw new Error('PDF tab closed.')
                      const next = fileAddressFor(sessionId, undefined, result.value.path)
                      pdfReaders.track(next, result.value.lease, ref)
                      ctx.sidebarRight.openResourceIn(occurrence.sessionId, next, {
                        replaceTab: occurrence.tabId,
                      })
                    } catch (error) {
                      pdfReaders.forget(fileAddressFor(sessionId, undefined, result.value.path))
                      const released = await ctx.remote.zotero.releaseUrlPdf({
                        lease: result.value.lease,
                      })
                      if (!released.ok) throw new Error(released.error.message)
                      throw error
                    }
                  } finally {
                    unsubscribe()
                  }
                },
              }),
            },
            ZoteroPdfRecoveryMenu,
          ),
        ),
      ),
    )

    const disposeInputButton = ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: `${REGISTRANT}.composer.button`,
          order: 80,
          locale: NS,
          registrant: REGISTRANT,
          inject: () => ({ onOpen: () => ctx.sidebarRight.openTab(LIBRARY_TAB_KIND) }),
        },
        ZoteroComposerSlot,
      ),
    )

    const disposeDeliverableAction = ctx.slots.inject('deliverables.file.actions', () =>
      ctx.slots.register(
        {
          name: 'deliverables.file.actions',
          id: `${REGISTRANT}.deliverables.action`,
          locale: NS,
          registrant: REGISTRANT,
          inject: openLibraryFace,
        },
        DeliverableZoteroAction,
      ),
    )

    const disposeDocumentActions = ctx.slots.inject('sidebar.right.tab.document.actions', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.tab.document.actions',
          id: `${REGISTRANT}.document.action`,
          locale: NS,
          registrant: REGISTRANT,
          inject: openLibraryFace,
        },
        DocumentOpenLibraryAction,
      ),
    )

    const disposeDocumentUnpreviewable = ctx.slots.inject(
      'sidebar.right.tab.document.unpreviewable',
      () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.tab.document.unpreviewable',
            id: `${REGISTRANT}.document.unpreviewable`,
            locale: NS,
            registrant: REGISTRANT,
            inject: openLibraryFace,
          },
          DocumentOpenLibraryAction,
        ),
    )

    const disposeContextIcon = ctx.slots.inject('contextMenu.icon', () =>
      ctx.slots.register(
        {
          name: 'contextMenu.icon',
          key: LIBRARY_ICON_KEY,
          registrant: REGISTRANT,
        },
        () => createElement(ZoteroLibraryIcon, { size: 14 }),
      ),
    )

    let disposeMenus = () => {}
    const menuFiber = ctx.inject(['contextMenus'], (menuCtx: ClientContext) => {
      const disposeFileMenu = menuCtx.contextMenus.register({
        id: `${REGISTRANT}.file`,
        target: 'file',
        order: 150,
        resolve: (target) => {
          if (!isBibliographyPath(target.path)) return []
          return [
            {
              id: 'openInLibrary',
              label: panelT('openInLibraryPanel'),
              icon: { key: LIBRARY_ICON_KEY },
              run: () => {
                ctx.sidebarRight.openTabIn(target.sessionId, LIBRARY_TAB_KIND)
              },
            },
          ]
        },
      })

      // The desktop hand-off calls the global `zotero/openProtocol` endpoint, so
      // it is registered only while the Host grants that action. Copying the
      // select link is a local clipboard write and stays available to every
      // peer that reached the item at all.
      const disposeOpenInDesktop = menuCtx.remoteAccess.whenAccess('zotero/openProtocol', () => {
        const dispose = menuCtx.contextMenus.register({
          id: `${REGISTRANT}.item.open`,
          target: 'zoteroItem',
          order: 100,
          resolve: (target) => {
            const selectUrl = selectUrlOf(target.ref)
            if (!selectUrl) return []
            return [
              {
                id: 'openInDesktop',
                label: panelT('openInZotero'),
                icon: { key: LIBRARY_ICON_KEY },
                run: async () => {
                  // This resolve callback runs outside the React tree, so the
                  // root-provided `useZoteroClient` prop is not available here;
                  // the one face in `surfaces` is the out-of-tree access point.
                  await client.openProtocol(selectUrl)
                },
              },
            ]
          },
        })
        return () => dispose()
      })

      const disposeCopyLinkMenu = menuCtx.contextMenus.register({
        id: `${REGISTRANT}.item.copy`,
        target: 'zoteroItem',
        order: 110,
        resolve: (target) => {
          const selectUrl = selectUrlOf(target.ref)
          if (!selectUrl) return []
          return [
            {
              id: 'copySelectLink',
              label: panelT('copyZoteroLink'),
              failureLabel: panelT('menuCopyLinkFailed'),
              run: async () => {
                const accepted = await writeClipboard(selectUrl)
                menuCtx.contextMenus.notify(
                  accepted ? panelT('copied') : panelT('libraryCopyClipboardUnavailable'),
                  accepted,
                )
              },
            },
          ]
        },
      })

      disposeMenus = () => {
        disposeCopyLinkMenu()
        disposeOpenInDesktop()
        disposeFileMenu()
      }
    })

    return () => {
      disposeMenus()
      void menuFiber.dispose()
      disposeContextIcon()
      disposeDocumentUnpreviewable()
      disposeDocumentActions()
      disposeDeliverableAction()
      disposeInputButton()
      disposeTabMenu()
      disposePdfRecovery()
      disposeTabTitle()
      disposeTabBody()
      disposeParsedTab()
      refreshBindings.clear()
      disposeTabDef()
    }
  }

  // The `library` settings namespace is served exactly while the
  // `dsh-zotero/library` row is composed; with the row off, no surface
  // registers and no `zotero/browse|search|item|childPage|export|write` call is made.
  //
  // The panel is additionally gated on the Host's remote access: a peer
  // without the global `zotero/browse` grant may not read the library, so the
  // whole surface group (tab type, body, title, tab menu, composer button,
  // deliverable and document actions) stays withdrawn for it. The write
  // entry has its own, narrower gate: `zotero/write` resolves the session
  // resource, so it is answered per session inside the panel.
  ctx.effect(
    () =>
      ctx.configForms.whileServed([ZOTERO_LIBRARY_SETTINGS_NAMESPACE], () =>
        ctx.remoteAccess.whenAccess('zotero/browse', () => {
          const right = gatedMount(mountRight)
          // The surface's own switch is the only gate: `webEnabled` governs the
          // literature trail, and the panel's component row is checked by the
          // settings form that owns this namespace.
          const sync = (): void => {
            right.sync(sidebarEnabledOf(libraryForm, 'rightSidebarEnabled'))
          }
          const unsubscribeLibrary = libraryForm.subscribe(sync)
          sync()
          return () => {
            unsubscribeLibrary()
            right.dispose()
          }
        }),
      ),
    'dsh-zotero: library right-sidebar surface',
  )
}

/**
 * Register every browser surface: the page dictionaries, the dedicated
 * tool cards, the bundle configuration page, the plugin-manager cards, and
 * the conversation tab.
 *
 * Runs on a fiber that declares `remote.zotero`, so the namespace is readable
 * through the official dotted form (`ctx.remote.zotero`), the same shape the
 * harness's own client plugins use.
 * @param ctx - the browser plugin context, scoped to the declared services.
 */
function registerUi(ctx: ClientContext): void {
  // The face is created here and handed to every group through `surfaces`;
  // no registration function owns a second copy or returns it as a value.
  const client = createZoteroClientFace(ctx)
  // One form controller per settings namespace. The bundle configuration page
  // edits all three at once; the dedicated rows edit their specific subsystem.
  // All live as long as the client fiber.
  const form = ctx.configForms.get<Record<string, unknown>>(ZOTERO_SETTINGS_NAMESPACE)
  const scholarlyForm = ctx.configForms.get<Record<string, unknown>>(SCHOLARLY_SETTINGS_NAMESPACE)
  const enrichmentForm = ctx.configForms.get<Record<string, unknown>>(ENRICHMENT_SETTINGS_NAMESPACE)
  const libraryForm = ctx.configForms.get<Record<string, unknown>>(
    ZOTERO_LIBRARY_SETTINGS_NAMESPACE,
  )
  const card = new ZoteroCardController(form)
  const credentialPort: ScholarlyCredentialPort & EnrichmentCredentialPort = {
    describe: (refs) => ctx.remote.credentials.describe([...refs]),
    set: (ref, value) => ctx.remote.credentials.set(ref, value),
  }
  // The model endpoints answer from the enrichment component. A wire failure
  // keeps its stable code and structured details; only the exact
  // `gateway/service-unavailable` code means the component is absent. Every
  // other failure (permission, carrier, directory, hash, lock contention)
  // shows its real reason and stays recoverable.
  const modelPort: EnrichmentModelPort = {
    semanticModelStatus: async (request, signal) =>
      await ctx.remote.zotero.semanticModelStatus(request, signal),
    downloadSemanticModel: async (request, signal) =>
      await ctx.remote.zotero.downloadSemanticModel(request, signal),
    cancelSemanticModelDownload: async (request, signal) =>
      await ctx.remote.zotero.cancelSemanticModelDownload(request, signal),
    deleteSemanticModel: async (request, signal) =>
      await ctx.remote.zotero.deleteSemanticModel(request, signal),
    verifySemanticModel: async (request, signal) =>
      await ctx.remote.zotero.verifySemanticModel(request, signal),
  }
  const scholarlyCard = new ScholarlyFormController(scholarlyForm, credentialPort)
  const enrichmentCard = new EnrichmentFormController(enrichmentForm, credentialPort, modelPort)
  const libraryCard = new LibraryFormController(libraryForm)
  const citationCard = new CitationFormController(form)
  // Live connectivity for the conversation tab's status strip. This fiber is
  // only created once `$mount` published the namespace, so the call site reads
  // it directly. Concurrent probes share one in-flight call: multiple consumers
  // can ask in the same tick, and one status read per tick is the product
  // behavior, not a workaround.
  let inFlightProbe: Promise<RemoteResult<ZoteroStatusView>> | undefined
  const probe = (): Promise<RemoteResult<ZoteroStatusView>> => {
    if (inFlightProbe !== undefined) return inFlightProbe
    const task = ctx.remote.zotero.status().finally(() => {
      if (inFlightProbe === task) inFlightProbe = undefined
    })
    inFlightProbe = task
    return task
  }
  // One registry owns every reading-file lease, whichever surface opened the
  // file: the lease lives until the reader tab that holds it closes.
  const pdfReaders = createPdfReaderRegistry({
    inventory: ctx.sidebarRight.openTabs,
    storage: {
      getItem: (key) => globalThis.localStorage.getItem(key),
      setItem: (key, value) => globalThis.localStorage.setItem(key, value),
      removeItem: (key) => globalThis.localStorage.removeItem(key),
    },
    release: async (lease) => {
      const result = await ctx.remote.zotero.releaseUrlPdf({ lease })
      if (!result.ok) throw result.error
    },
    report: (error) =>
      reportCrashedSurface('action:release-pdf', error, undefined, client.reportClientError),
  })
  ctx.effect(() => () => pdfReaders.dispose())
  // The library preferences are read when a surface acts, not when it renders,
  // so a plain getter is enough: a reader that opens a URL PDF asks for the
  // current permission at the moment of the click.
  const preferenceSource = createLibraryPreferenceSource(libraryForm, form)
  ctx.effect(() => () => preferenceSource.dispose(), 'dsh-zotero: library preferences')
  const libraryPreferences = (): LibraryPreferences | undefined =>
    preferenceSource.getSnapshot().preferences
  // The declared client services are supplied by the post-mount UI fiber.
  // Host contracts also merge a jobs key into Cordis; keep this client seam typed as IJobs.
  const parsedDocuments = new ParsedDocuments(
    (request, signal) => ctx.remote.zotero.documentArtifact(request, signal),
    (sessionId) => ctx.remoteAccess.source('session', sessionId, 'zotero/documentArtifact'),
    (error) => ctx.logger.warn('Parsed-document lease release failed', error),
    { translate: ctx.locale.bind(NS) },
  )
  ctx.effect(
    () =>
      ctx.configForms.whileServed([ENRICHMENT_SETTINGS_NAMESPACE], () =>
        ctx.resources.register(parsedDocuments),
      ),
    'dsh-zotero: parsed document resources',
  )
  const parse = createDocumentParseSurface(
    {
      remote: ctx.remote,
      jobs: ctx.jobs as unknown as DocumentParseClientContext['jobs'],
      connection: (ctx as unknown as Pick<DocumentParseClientContext, 'connection'>).connection,
      configForms: ctx.configForms,
    },
    enrichmentForm,
    (sessionId, target) => {
      if (target.kind === 'attachment') parsedDocuments.committed(sessionId, target.ref)
    },
  )
  ctx.effect(() => () => parse.dispose(), 'dsh-zotero: document parsing surface')
  const surfaces: UiSurfaces = {
    parse,
    parsedDocuments,
    form,
    card,
    scholarlyCard,
    enrichmentCard,
    libraryForm,
    libraryCard,
    citationCard,
    probe,
    client,
    pdfReaders,
    libraryPreferences,
    preferenceSource,
  }
  // Shared effects still register first: dictionaries, session cache teardown,
  // root props, protocol toast, and crash intake precede the controllers' own
  // disposers and the per-surface registrations.
  registerSharedSurfaces(ctx, surfaces)
  ctx.effect(
    () => () => {
      card.dispose()
      scholarlyCard.dispose()
      enrichmentCard.dispose()
      libraryCard.dispose()
      citationCard.dispose()
    },
    'dsh-zotero: card forms',
  )
  ctx.effect(
    () =>
      ctx.remote.$on('credentials/reference-updated', (ref) => {
        scholarlyCard.refreshCredential(ref)
        enrichmentCard.refreshCredential(ref)
      }),
    'dsh-zotero: scholarly & enrichment credential invalidations',
  )
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
      'jobs',
      'connection',
      'remote.credentials',
      'remoteAccess',
      'locale',
      'slots',
      'configForms',
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
