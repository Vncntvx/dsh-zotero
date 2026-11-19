/**
 * Disclosure state for a component's external-egress authorization.
 *
 * Enabling `dsh-zotero/enrichment` accepts MinerU document egress, and enabling
 * `dsh-zotero/scholarly` authorizes external scholarly retrieval. The client
 * discloses each switch's scope whenever its component is served and this
 * browser has not acknowledged the disclosure — including at boot and when a
 * switch is flipped while the settings form is still loading.
 *
 * The acknowledgement is per browser and per disclosure version, so restarting
 * the host while the component stays on does not ask again. Observing the
 * component off through the namespace status revokes it, so a later enable asks
 * once more. Session state carries the acknowledgement and its revocation when
 * `localStorage` is unavailable; `localStorage` preserves an acknowledgement
 * across a restart. `EnableNoticeArbiter` shows one disclosure at a time in
 * registration order.
 * @module dsh-zotero/client/enable-notice
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { NamespaceStatus } from './helpers/namespace-status.ts'
export type { NamespaceStatus } from './helpers/namespace-status.ts'

/** The two hook names the overlay entries publish. */
export type EnableNoticeHookName = 'enrichmentEnableNotice' | 'scholarlyEnableNotice'

/** The overlay renders one modal, or nothing. */
export interface EnableNoticeState {
  readonly open: boolean
}

/** The status subset the controller reads from its component's card store. */
export interface NamespaceStatusSource {
  getSnapshot(): { readonly namespaceStatus: NamespaceStatus }
  subscribe(listener: () => void): () => void
}

/** Where one browser keeps its acknowledgement of one disclosure. */
export interface EnableNoticeAcknowledgement {
  /** Whether this browser already acknowledged the disclosure. */
  read(): boolean
  /** Persist the acknowledgement for this browser. */
  remember(): void
  /** Drop the acknowledgement: a later enable owes the disclosure again. */
  forget(): void
}

/**
 * The enrichment disclosure's acknowledgement key. The trailing version tracks
 * the disclosure's wording; revising the text advances the key so the new
 * disclosure is owed.
 */
export const ENRICHMENT_EGRESS_ACK_KEY = 'dsh-zotero:enrichment-egress-ack:2'

/** The scholarly disclosure's acknowledgement key, versioned the same way. */
export const SCHOLARLY_RETRIEVAL_ACK_KEY = 'dsh-zotero:scholarly-retrieval-ack:1'

/**
 * The acknowledgement as this browser keeps it.
 *
 * Session state takes precedence over `localStorage`, so a profile whose
 * `localStorage` refuses writes or removals still acknowledges and revokes the
 * disclosure for the rest of the session. `localStorage` preserves an
 * acknowledgement across a restart while the component stays on.
 * @param key - the disclosure's acknowledgement key.
 * @returns the acknowledgement port over this client's storage.
 */
export function clientAcknowledgement(key: string): EnableNoticeAcknowledgement {
  let session: boolean | undefined
  return {
    read: () => {
      if (session !== undefined) return session
      try {
        return localStorage.getItem(key) === '1'
      } catch {
        return false
      }
    },
    remember: () => {
      session = true
      try {
        localStorage.setItem(key, '1')
      } catch {
        // Session state closes the disclosure for this session.
      }
    },
    forget: () => {
      session = false
      try {
        localStorage.removeItem(key)
      } catch {
        // Session state revokes it, so a later enable discloses.
      }
    },
  }
}

/** The snapshot store one entry publishes under its own hook name. */
export type EnableNoticeHooks<Hook extends EnableNoticeHookName> = {
  readonly [K in Hook]: SnapshotStore<EnableNoticeState>
}

/** State and dismissal bound into one `shell.overlay` entry. */
export interface EnableNoticeFace<Hook extends EnableNoticeHookName> {
  readonly hooks: EnableNoticeHooks<Hook>
  dismiss(): void
}

/** One controller's disclosure debt, as the arbiter sees it. */
interface EnableNoticeEntry {
  readonly owed: () => boolean
  readonly setVisible: (visible: boolean) => void
}

/**
 * Show one disclosure at a time.
 *
 * Two components can be served at once, and both owe their disclosure. Their
 * overlays stay separate registrations with separate hooks, but a single
 * arbiter admits only the first owed one; dismissing it lets the next appear.
 * Registration order is the order the client wires the two overlays.
 */
export class EnableNoticeArbiter {
  private readonly entries = new Set<EnableNoticeEntry>()

  /** Add one disclosure; the arbiter owns its visibility from here on. */
  register(entry: EnableNoticeEntry): void {
    this.entries.add(entry)
    this.refresh()
  }

  /** Withdraw one disclosure (on teardown); the next owed one may show. */
  unregister(entry: EnableNoticeEntry): void {
    entry.setVisible(false)
    this.entries.delete(entry)
    this.refresh()
  }

  /** Recompute visibility after a status change, a dismissal, or a removal. */
  refresh(): void {
    let visible = false
    for (const entry of this.entries) {
      const show = !visible && entry.owed()
      entry.setVisible(show)
      if (show) visible = true
    }
  }
}

/** One component's disclosure, driven by its card store's namespace status. */
export class EnableNoticeController<Hook extends EnableNoticeHookName> {
  private readonly store = createSnapshotStore<EnableNoticeState>({ open: false })
  private owed = false
  private visible = false
  private disposed = false
  /** The last settled status; `loading` never settles. */
  private lastStatus: NamespaceStatus | undefined
  private readonly unsubscribe: () => void
  private readonly entry: EnableNoticeEntry

  /**
   * @param source - the component's card store; its `namespaceStatus` decides.
   * @param hook - the hook name this controller publishes its snapshot under.
   * @param acknowledgement - the per-client acceptance it reads and writes.
   * @param arbiter - the shared admission order; required, never optional.
   */
  constructor(
    private readonly source: NamespaceStatusSource,
    private readonly hook: Hook,
    private readonly acknowledgement: EnableNoticeAcknowledgement,
    private readonly arbiter: EnableNoticeArbiter,
  ) {
    this.entry = {
      owed: () => this.owed,
      setVisible: (visible) => this.setVisible(visible),
    }
    this.arbiter.register(this.entry)
    this.observe()
    this.unsubscribe = source.subscribe(() => {
      this.observe()
    })
  }

  /**
   * The notice is owed exactly while the component is served and this browser
   * has not acknowledged the disclosure. `loading` says nothing yet, so the
   * state it was in stays; any other status decides. Observing the component
   * off ends the authorization, so its acknowledgement is dropped and the next
   * enable owes the disclosure again.
   */
  private observe(): void {
    if (this.disposed) return
    const status = this.source.getSnapshot().namespaceStatus
    if (status === 'loading') return
    if (status !== this.lastStatus) {
      if (status !== 'ready') this.acknowledgement.forget()
      this.lastStatus = status
    }
    this.owed = status === 'ready' && !this.acknowledgement.read()
    this.arbiter.refresh()
  }

  /** The arbiter alone decides which owed disclosure the user sees. */
  private setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    this.store.set({ open: visible })
  }

  /** Clear the disclosure debt; the arbiter refreshes visibility afterwards. */
  private accept(): void {
    if (this.disposed || !this.owed) return
    this.acknowledgement.remember()
    this.owed = false
  }

  /** Accept the disclosure shown for this enable. */
  dismiss(): void {
    if (this.disposed || !this.visible) return
    this.accept()
    this.arbiter.refresh()
  }

  inject(): EnableNoticeFace<Hook> {
    // The computed key is the one place a generic hook name needs an assertion:
    // an object literal with a generic key widens to a string index, while
    // `Hook` is exactly the single key this face publishes.
    const hooks = { [this.hook]: this.store } as EnableNoticeHooks<Hook>
    return {
      hooks,
      dismiss: () => {
        this.dismiss()
      },
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.arbiter.unregister(this.entry)
  }
}
