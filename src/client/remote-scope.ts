/**
 * The settings-page scope over the zotero Remote namespace: implements the
 * browser `SettingsScope` contract (the same one `ctx.settingsScope.bind`
 * returns) so the shared staged form runs unchanged, while every read and
 * write rides the plugin's own Typert endpoints instead of the harness's
 * settings RPC. The harness exposes settings namespaces to the browser only
 * through an explicit product allowlist; the Remote path keeps the page
 * functional in an unmodified harness.
 * @module dsh-zotero/client/remote-scope
 */

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroConfigView } from './remote.ts'

/** The mounted zotero Remote face, resolved after `$mount` settles. */
export type ZoteroRemoteFace = TypertRemoteNamespaceMap['zotero']

/**
 * A live `SettingsScope` over the zotero Remote namespace.
 *
 * The scope starts `loading` and publishes its first snapshot when the apply
 * entry calls `connect()` after the Remote mount settles. Every write goes
 * out with the last known namespace revision; a refused write (validation
 * failure, moved namespace) reloads the Host view instead of resolving, so
 * the form's read-back reports it as a save that did not land. Writes are
 * immediate and carry the snapshot revision at call time; the interface
 * contract's write-queue and latest-settlement rules are intentionally not
 * implemented — the form's sequential save and the host's revision fencing
 * make the final state converge to the Host truth.
 */
export class RemoteScope implements SettingsScope<Record<string, unknown>> {
  private snapshot: SettingsScopeSnapshot<Record<string, unknown>> = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'host',
  }
  private readonly listeners = new Set<() => void>()
  private connected = false

  /**
   * @param face - resolves the mounted Remote face; undefined until the mount
   *   settles, and after a connection reset unmounts it.
   */
  constructor(private readonly face: () => ZoteroRemoteFace | undefined) {}

  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<Record<string, unknown>> {
    return this.snapshot
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Start the first load. Called once the Remote face is mounted; idempotent.
   * @returns settlement after the first snapshot publishes (or the load fails silently).
   */
  async connect(): Promise<void> {
    if (this.connected) return
    this.connected = true
    await this.reload()
  }

  /**
   * Merge one field into the user layer through the Remote namespace.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write; a refused write reloads instead.
   */
  async set(field: string, value: unknown): Promise<void> {
    const face = this.face()
    if (face === undefined) return
    const result = await face.configUpdate({ [field]: value }, this.snapshot.revision)
    if (result.ok) this.apply(result.value)
    else await this.reload()
  }

  /**
   * Clear one field from the user layer so it re-inherits the composition layer.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear; a refused clear reloads instead.
   */
  async unset(field: string): Promise<void> {
    const face = this.face()
    if (face === undefined) return
    const result = await face.configClear(field, this.snapshot.revision)
    if (result.ok) this.apply(result.value)
    else await this.reload()
  }

  /** Re-read the Host view and publish it; a failed read keeps the last snapshot. */
  private async reload(): Promise<void> {
    const face = this.face()
    if (face === undefined) return
    const result = await face.config()
    if (result.ok) this.apply(result.value)
  }

  private apply(view: ZoteroConfigView): void {
    this.snapshot = {
      status: view.available ? 'ready' : 'unavailable',
      value: view.value,
      base: view.base,
      user: view.user,
      revision: view.revision,
      writable: view.writable,
      mode: 'host',
    }
    for (const listener of this.listeners) listener()
  }
}
