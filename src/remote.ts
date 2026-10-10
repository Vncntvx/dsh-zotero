/**
 * The dsh-zotero host Remote service (wire namespace `zotero`, cordis key
 * {@link ZOTERO_STATUS_SERVICE_KEY}; the `zotero` key is the research
 * service's own).
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
import { LOCAL_PROVIDER_ID } from './constants.js'
import {
  ZOTERO_DIAGNOSIS_OK,
  ZOTERO_SETTINGS_NAMESPACE,
  ZOTERO_STATUS_SERVICE_KEY,
  type ZoteroAttachmentLocationView,
  type ZoteroStatusView,
} from './contract.js'

/** The zotero settings page's host service: the web tab's connectivity probe. */
export class ZoteroRuntime extends TypertRemoteService {
  /**
   * Register the service under the shared cordis key bound to the `zotero`
   * wire namespace.
   * @param ctx - owning cordis context.
   */
  constructor(ctx: Context) {
    super(ctx, ZOTERO_STATUS_SERVICE_KEY, { namespace: ZOTERO_SETTINGS_NAMESPACE })
  }

  /**
   * Live connectivity view for the dedicated web tab: the service's status
   * probe with absent optional facts stripped (the strict wire codec rejects
   * undefined field keys). The endpoint rides unconditionally: a provider that
   * answered dialled something, and the card's live refresh replaces the parsed
   * text with this view, so an endpoint dropped here would make the address
   * disappear the moment the user clicked Refresh. The success sentinel
   * `ZOTERO_DIAGNOSIS_OK` is stripped the same way: a connected probe has
   * nothing to diagnose, so the card never renders a diagnosis box for a
   * healthy service.
   * @returns the connectivity view; the provider converges failures into it.
   */
  async status(): Promise<ZoteroStatusView> {
    const status = await this.ctx.get('zotero')?.status()
    if (status === undefined) {
      return {
        providerId: LOCAL_PROVIDER_ID,
        connected: false,
        diagnosis: 'The Zotero service is not composed.',
      }
    }
    return {
      providerId: status.providerId,
      endpoint: status.endpoint,
      connected: status.connected,
      ...(status.apiVersion === undefined ? {} : { apiVersion: status.apiVersion }),
      ...(status.serverId === undefined ? {} : { serverId: status.serverId }),
      ...(status.schemaVersion === undefined ? {} : { schemaVersion: status.schemaVersion }),
      ...(status.zoteroVersion === undefined ? {} : { zoteroVersion: status.zoteroVersion }),
      ...(status.write === undefined ? {} : { write: status.write }),
      ...(status.diagnosis === ZOTERO_DIAGNOSIS_OK ? {} : { diagnosis: status.diagnosis }),
    }
  }

  /**
   * Resolve an attachment ref to its local file path or web URL for in-app reading.
   * @param ref - the item or attachment ref string.
   * @returns the resolved location view.
   */
  async resolveAttachment(ref: string): Promise<ZoteroAttachmentLocationView> {
    const service = this.ctx.get('zotero')
    if (service === undefined) {
      throw new Error('The Zotero service is not composed.')
    }
    return await service.resolveAttachment(ref)
  }
}
