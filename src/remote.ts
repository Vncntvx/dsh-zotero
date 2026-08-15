/**
 * The dsh-zotero host Remote service (wire namespace `zotero`, cordis key
 * `zoteroRemote` — the `zotero` key is the research service's own).
 *
 * Registered as a TypertRemoteService so the Host Gateway can bind and
 * validate the service; the endpoints themselves are claimed by the strict
 * manifest in typert.ts (`ctx.typert.register`), which is the gateway's
 * preferred resolution path and needs no `@Remote` markers. Avoiding the
 * decorators also keeps the source runnable under Node's plain TypeScript
 * type stripping, which rejects decorator syntax. The three endpoints serve
 * the settings page: read the namespace view, merge a user-layer patch, and
 * clear one field (the removal a merge-only patch cannot express). All
 * writes go through the local settings seam — validation, revision fencing,
 * persistence, and the live rebuild that follows are the harness's own — so
 * the page needs no settings-RPC exposure and works in an unmodified harness.
 * @module dsh-zotero/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ZoteroConfigView, ZoteroStatusView } from './contract.js'
import type { ZoteroService } from './service.js'
import { ZOTERO_SETTINGS_NAMESPACE } from './settings-namespace.js'

/**
 * One descriptor's redacted view as the settings page reads it.
 *
 * Absent layers are omitted rather than carried as `undefined`: the strict
 * wire codec keeps an `undefined` field key after parsing, and the gateway's
 * JSON-safety boundary check rejects it — absent keys are the wire's only
 * representation of absence.
 */
function namespaceView(settings: SettingsProvider | undefined): ZoteroConfigView {
  if (settings === undefined) return { available: false, writable: false }
  const descriptor = settings
    .describe({ redactSecrets: true })
    .find((candidate) => String(candidate.ns) === ZOTERO_SETTINGS_NAMESPACE)
  if (descriptor === undefined) return { available: false, writable: false }
  // The settings seam always resolves a registered namespace to a value; the
  // guard stays for symmetry with the layers below, which can be absent.
  /* v8 ignore next -- a registered namespace always carries a resolved value. */
  return {
    available: true,
    writable: settings.writable,
    revision: descriptor.revision,
    ...(descriptor.value !== undefined
      ? { value: descriptor.value as Record<string, unknown> }
      : {}),
    ...(descriptor.base !== undefined ? { base: descriptor.base as Record<string, unknown> } : {}),
    ...(descriptor.user !== undefined ? { user: descriptor.user as Record<string, unknown> } : {}),
  }
}

/** The zotero settings page's host service: read and write the namespace. */
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

  /**
   * Read the namespace view the page renders: layers, writability, revision.
   * @returns the current view; `available` false without a settings service.
   */
  async config(): Promise<ZoteroConfigView> {
    return namespaceView(this.ctx.get('settings') as SettingsProvider | undefined)
  }

  /**
   * Merge a patch into the namespace's user layer through the settings seam.
   * @param patch - plain-object patch over the user section.
   * @param revision - namespace revision the caller read; a moved namespace rejects.
   * @returns the view after the committed write.
   */
  async configUpdate(patch: Record<string, unknown>, revision?: number): Promise<ZoteroConfigView> {
    const settings = this.ctx.get('settings') as SettingsProvider | undefined
    if (settings === undefined) throw new Error('the zotero settings namespace is not composed')
    await settings.update(settingsNamespace(ZOTERO_SETTINGS_NAMESPACE), patch, revision)
    return namespaceView(settings)
  }

  /**
   * Clear one field from the user layer so it re-inherits the composition
   * base — the write a merge-only patch cannot express.
   * @param field - field name inside the namespace section.
   * @param revision - namespace revision the caller read; a moved namespace rejects.
   * @returns the view after the committed write.
   */
  async configClear(field: string, revision?: number): Promise<ZoteroConfigView> {
    const settings = this.ctx.get('settings') as SettingsProvider | undefined
    if (settings === undefined) throw new Error('the zotero settings namespace is not composed')
    const ns = settingsNamespace(ZOTERO_SETTINGS_NAMESPACE)
    const descriptor = settings
      .describe({ redactSecrets: true })
      .find((candidate) => String(candidate.ns) === ZOTERO_SETTINGS_NAMESPACE)
    if (descriptor === undefined) throw new Error('the zotero settings namespace is not composed')
    const user = { ...((descriptor.user as Record<string, unknown> | undefined) ?? {}) }
    delete user[field]
    await settings.replace(ns, user, revision)
    return namespaceView(settings)
  }
}
