/**
 * The live `webEnabled` gate for the browser surfaces the flag governs: the
 * conversation Sources tab and the library panel. Until the first settings
 * snapshot arrives the gate reads enabled; an explicit `webEnabled: false`
 * withdraws a surface without a reload, and a later toggle restores it.
 * @module dsh-zotero/client/web-enabled
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * The current `webEnabled` value: false only when a ready snapshot says so.
 * @param form - the Zotero settings form the flag lives in.
 * @returns whether the flag currently permits browser surfaces.
 */
export function webEnabledOf(form: ConfigForm<Record<string, unknown>>): boolean {
  const snapshot = form.getSnapshot()
  return snapshot.status !== 'ready' || snapshot.value?.webEnabled !== false
}

/**
 * Subscribe to the `webEnabled` flag and report its live value immediately.
 *
 * @param form - the Zotero settings form the flag lives in.
 * @param onChange - receives the current enabled verdict, now and on every
 * settings revision that changes it.
 * @returns the unsubscribe function.
 */
export function watchWebEnabled(
  form: ConfigForm<Record<string, unknown>>,
  onChange: (enabled: boolean) => void,
): () => void {
  const sync = (): void => onChange(webEnabledOf(form))
  const unsubscribe = form.subscribe(sync)
  sync()
  return unsubscribe
}

/** A mount the gate drives without remounting what is already up. */
export interface GatedMount {
  /** Mount when enabled, withdraw when not; repeating a value does nothing. */
  sync: (enabled: boolean) => void
  /** Withdraw the mounted group, if any. */
  dispose: () => void
}

/**
 * Wrap one surface group's mount so a live gate can drive it.
 * @param mount - registers the group's surfaces, returning their disposer.
 * @returns the idempotent mount/withdraw pair.
 */
export function gatedMount(mount: () => () => void): GatedMount {
  let dispose: (() => void) | undefined
  return {
    sync(enabled: boolean): void {
      if (enabled && dispose === undefined) {
        dispose = mount()
      } else if (!enabled && dispose !== undefined) {
        dispose()
        dispose = undefined
      }
    },
    dispose(): void {
      dispose?.()
      dispose = undefined
    },
  }
}

/**
 * Mount a surface group behind a live gate. `watch` reports the value now and
 * on every revision; disposing the owning fiber unsubscribes and withdraws
 * the group.
 *
 * @param ctx - the browser plugin context.
 * @param fiber - the name the owning effect declares.
 * @param watch - subscribes to the gate's value.
 * @param mount - registers the gated surfaces, returning their disposer.
 */
export function registerGatedSurfaces(
  ctx: ClientContext,
  fiber: string,
  watch: (onChange: (enabled: boolean) => void) => () => void,
  mount: () => () => void,
): void {
  const gate = gatedMount(mount)
  ctx.effect(() => {
    const unsubscribe = watch(gate.sync)
    return () => {
      unsubscribe()
      gate.dispose()
    }
  }, fiber)
}
