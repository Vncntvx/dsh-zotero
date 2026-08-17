/**
 * The dsh-zotero host Remote service (wire namespace `zotero`, cordis key
 * `zoteroRemote` — the `zotero` key is the research service's own).
 *
 * Registered as a TypertRemoteService so the Host Gateway can bind and
 * validate the service; the endpoints themselves are claimed by the strict
 * manifest in typert.ts (`ctx.typert.register`), which is the gateway's
 * preferred resolution path and needs no `@Remote` markers. Avoiding the
 * decorators also keeps the source runnable under Node's plain TypeScript
 * type stripping, which rejects decorator syntax. The one endpoint serves the
 * web tab's live connectivity probe; the settings page reads and writes the
 * namespace through the harness's own settings scope instead, so this service
 * no longer carries the namespace view or any user-layer mutation.
 * @module dsh-zotero/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroStatusView } from './contract.js'
import type { ZoteroService } from './service.js'
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js'

/** The zotero settings page's host service: the web tab's connectivity probe. */
export class ZoteroRuntime extends TypertRemoteService {
  /**
   * Register the service under the `zoteroRemote` key bound to the `zotero`
   * wire namespace.
   * @param ctx - owning cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, 'zoteroRemote', { namespace: ZOTERO_SETTINGS_NAMESPACE })
  }

  /**
   * Live connectivity view for the dedicated web tab: the service's status
   * probe with absent optional facts stripped (the strict wire codec rejects
   * undefined field keys).
   * @returns the connectivity view; the provider converges failures into it.
   */
  async status(): Promise<ZoteroStatusView> {
    const status = await (this.ctx.get('zotero') as ZoteroService | undefined)?.status()
    if (status === undefined) {
      return {
        providerId: 'zotero',
        connected: false,
        diagnosis: 'The Zotero service is not composed.',
      }
    }
    return {
      providerId: status.providerId,
      connected: status.connected,
      ...(status.apiVersion === undefined ? {} : { apiVersion: status.apiVersion }),
      ...(status.serverId === undefined ? {} : { serverId: status.serverId }),
      ...(status.schemaVersion === undefined ? {} : { schemaVersion: status.schemaVersion }),
      diagnosis: status.diagnosis,
    }
  }
}
