/**
 * The inject faces this plugin's Plugins-page entries publish. Each face is
 * what a registration's `inject` factory returns: plain members plus one
 * `hooks` compartment, whose values are bare `getSnapshot`/`subscribe`
 * sources the renderer binds to `use<Name>` selector hooks — the component
 * receives the hook, never the source (harness `docs/subsystems/slots.md`).
 * @module dsh-zotero/client/components/plugin/faces
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from '../../remote.ts'

/** The probe face the two status cards inject (activation guide, detail section). */
export interface ZoteroProbeFace {
  readonly t: TranslateNS<'zotero'>
  readonly probe: () => Promise<RemoteResult<ZoteroStatusView>>
}

/** The two boolean fields the quick config toggles. */
export type QuickConfigField = 'webEnabled' | 'writeEnabled'

/**
 * The quick config's inject face: the translator, the shared `zotero` form as
 * the bound snapshot source, and the two-field write edge.
 */
export interface ZoteroBundleQuickConfigFace {
  readonly t: TranslateNS<'zotero'>
  hooks: {
    /** Quick config snapshot bound by the renderer as useZoteroQuickConfig. */
    zoteroQuickConfig: ObservableSnapshot<ConfigFormSnapshot<Record<string, unknown>>>
  }
  setField: (field: QuickConfigField, value: boolean) => void
}

/**
 * Build the quick config's face over the shared namespace form. `ConfigForm`
 * is itself a bare `getSnapshot`/`subscribe` source, so it enters `hooks`
 * unwrapped — one observable, no mirror to keep in step. The write edge is
 * `ConfigForm.set`, whose revision handling is the form's own.
 * @param form - the shared configuration form for the `zotero` namespace.
 * @param t - the bound translator for the plugin's locale namespace.
 * @returns the quick config's snapshot source, translator and write edge.
 */
export function zoteroQuickConfigFace(
  form: ConfigForm<Record<string, unknown>>,
  t: TranslateNS<'zotero'>,
): ZoteroBundleQuickConfigFace {
  return {
    t,
    hooks: { zoteroQuickConfig: form },
    setField: (field, value) => {
      void form.set(field, value)
    },
  }
}
