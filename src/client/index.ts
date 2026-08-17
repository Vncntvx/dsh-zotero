/**
 * Zotero settings, browser half — one surface over the `zotero` namespace:
 * a card in the harness's Plugins configuration tab (`settings.plugin.item`,
 * keyed by the namespace it edits) carrying the full configuration form in
 * the section's native disclosure chrome.
 *
 * The card reads and writes the `zotero` namespace through the harness's own
 * settings scope (`ctx.settingsScope`) — the rc.7 seam that serves every
 * registered namespace — with the same staged form the harness's own plugin
 * cards use (stage locally, write only on save, mark user-layer presence as
 * overridden). The Typert Remote namespace carries only the live connectivity
 * probe the dedicated conversation tab renders. The namespace spelling comes
 * from the shared settings-namespace module, so the two halves cannot drift
 * apart.
 * @module dsh-zotero/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only Context merges: locale (ctx.locale) arrives through its package's
// client declaration; the Remote face (ctx.remote) through the api-remotes
// assembly; ui-settings supplies the `settingsScope` service; ui-settings-plugins
// the keyed `settings.plugin.item` slot this card registers into. Cross-plugin
// collaboration rides services and slot declarations, never value imports
// (client bundle purity).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: the `conversation.view` SlotMap row (declared by the slot's
// owning package) must be in the program for the tab registration to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ZoteroPluginCard } from './ZoteroPluginCard.tsx'
import { SourcesTab, type SourcesTabFace } from './components/SourcesTab.tsx'
import { ZOTERO_REMOTE } from './remote.ts'
import type { ZoteroRemoteFace } from './remote.ts'
import { ZoteroCardController } from './zotero-card-controller.ts'
import { ZOTERO_SETTINGS_NAMESPACE } from '../settings-namespace.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'zotero'

/** Required services (cordis fiber inject): settingsScope's binder resolves the caller's connection and remote. */
export const inject = ['locale', 'slots', 'connection', 'settingsScope', 'remote']

/**
 * Mount the Zotero configuration card into the Plugins tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-zotero: page dictionaries')
  // One binder for the namespace the host half registers; the card stages and
  // saves through it. The lenient decode keeps the served plain-object section
  // as-is: the wire schema's own rehydration would re-validate a resolved
  // shape this plugin does not enumerate, and the per-field form parse is the
  // authority the card uses.
  const scope = ctx.settingsScope.bind({
    namespace: ZOTERO_SETTINGS_NAMESPACE,
    decode: (section) =>
      typeof section === 'object' && section !== null && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : undefined,
  })
  const card = new ZoteroCardController(scope)

  // The configuration card: the Plugins tab dispatches one card per served
  // namespace key, so registering under the namespace key pairs this card with
  // the host's section with no web-app change. Keyed entries declare no
  // `order`; the tab stacks cards in registration order.
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: ZOTERO_SETTINGS_NAMESPACE,
        locale: NS,
        inject: () => card.inject(),
      },
      ZoteroPluginCard,
    ),
  )

  // The mounted namespace handle resolves through the service store
  // (`ctx.reflect.get`), not through `ctx.remote.zotero`: the generated-style
  // dotted read walks the cordis fiber chain, which stops at the Loader's
  // runtime-less internal forks between a plugin entry and the root fiber —
  // the namespace service mounted under the gateway entry is unreachable that
  // way (the store path resolves it by isolation label instead).
  let zotero: ZoteroRemoteFace | undefined
  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount(ZOTERO_REMOTE)
    zotero = (ctx.reflect as unknown as { get(name: string): unknown }).get('remote.zotero') as
      ZoteroRemoteFace | undefined
    if (zotero === undefined) {
      throw new Error('dsh-zotero: the zotero Remote namespace did not mount')
    }
    // The dedicated Sources panel (a conversation tab) registers unless the
    // `webEnabled` namespace flag is explicitly off; before the first snapshot
    // the tab stays on, so a config hiccup never blocks it. The gate is live:
    // toggling the flag in the card hides or restores the tab without a
    // reload.
    let tabDispose: (() => void) | undefined
    const tabT = ctx.locale.bind(NS)
    const sync = (): void => {
      const snapshot = scope.getSnapshot()
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
              inject: (): SourcesTabFace => ({
                status: () => zotero!.status(),
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
    const unsubscribe = scope.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      tabDispose?.()
      zotero = undefined
      void dispose()
    }
  }, 'dsh-zotero: remote')
}
