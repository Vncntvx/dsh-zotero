/**
 * Zotero settings page, browser half — a dedicated section in the harness's
 * Settings panel (a sibling of General, Models, and Plugins), editing the
 * `zotero` settings namespace the host half registers (composition entry as
 * its base layer, changes applied live).
 *
 * The page registers into `settings.section`, the settings shell's page
 * slot — a plain UI seat with no namespace-exposure requirement — and reads
 * and writes through the plugin's own Typert Remote endpoints (`ctx.remote`
 * mount plus `ctx.reflect` resolution, the dsh-at-file channel), so nothing
 * about the harness's settings-RPC allowlist gates it. The namespace spelling
 * comes from the shared settings-namespace module, so the two halves cannot
 * drift apart.
 * @module dsh-zotero/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only Context merges: locale (ctx.locale) arrives through its package's
// client declaration; the Remote face (ctx.remote) through the api-remotes
// assembly; ui-settings supplies the `settings.section` SlotMap entry this
// page registers into. Cross-plugin collaboration rides services and slot
// declarations, never value imports (client bundle purity).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ZoteroSettingsSection } from './ZoteroSettingsSection.tsx'
import { ZOTERO_REMOTE } from './remote.ts'
import { RemoteScope, type ZoteroRemoteFace } from './remote-scope.ts'
import { ZoteroCardController } from './zotero-card-controller.ts'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'zotero'

/**
 * The Zotero brand glyph as JSON icon data (the settings shell renders it
 * inline in `currentColor`): the official mark, monochrome for the nav rail.
 */
const NAV_ICON = {
  path: 'M21.231 2.462 7.18 20.923h14.564V24H2.256v-2.462L16.308 3.076H2.975V0h18.256v2.462z',
}

/** Required services (cordis fiber inject). */
export const inject = ['locale', 'slots', 'remote']

/**
 * Mount the Zotero settings page into the Settings panel.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-zotero: page dictionaries')
  // The mounted namespace handle resolves through the service store
  // (`ctx.reflect.get`), not through `ctx.remote.zotero`: the generated-style
  // dotted read walks the cordis fiber chain, which stops at the Loader's
  // runtime-less internal forks between a plugin entry and the root fiber —
  // the namespace service mounted under the gateway entry is unreachable
  // that way (the store path resolves it by isolation label instead).
  let zotero: ZoteroRemoteFace | undefined
  const scope = new RemoteScope(() => zotero)
  ctx.effect(async () => {
    const dispose = await ctx.remote.$mount(ZOTERO_REMOTE)
    zotero = (ctx.reflect as unknown as { get(name: string): unknown }).get('remote.zotero') as
      ZoteroRemoteFace | undefined
    if (zotero === undefined) {
      throw new Error('dsh-zotero: the zotero Remote namespace did not mount')
    }
    await scope.connect()
    return () => {
      zotero = undefined
      void dispose()
    }
  }, 'dsh-zotero: remote')
  const card = new ZoteroCardController(scope)
  const t = ctx.locale.bind(NS)
  // `slots.inject` waits for the settings shell's declaration of
  // `settings.section`, so the page survives shell reloads and vanishes
  // atomically with this fiber.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'zotero',
        order: 30,
        label: () => t('nav'),
        locale: NS,
        // The nav glyph: the settings shell renders a registration-provided
        // icon ahead of its built-in id map (ui-settings-general).
        icon: NAV_ICON,
        inject: () => card.inject(),
      },
      ZoteroSettingsSection,
    ),
  )
}
