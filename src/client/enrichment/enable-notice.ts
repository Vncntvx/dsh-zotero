/**
 * Disclosure state for the enrichment component's document egress.
 *
 * Enabling the component is the deployment's acceptance of MinerU document
 * egress, so the client owes the user a disclosure of what that enables. The
 * notice shows whenever the component is served and this client has not
 * acknowledged the disclosure — including a deployment that was already enabled
 * at boot, which a first-settled-status baseline used to hide, and including a
 * switch flipped while the settings form was still loading. Dismissal writes a
 * per-client record, so the disclosure is owed once per browser: disabling and
 * re-enabling the component does not ask again in the same browser.
 * @module dsh-zotero/client/enrichment/enable-notice
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The namespace lifecycle the settings form already tracks. */
export type EnrichmentNamespaceStatus = 'loading' | 'ready' | 'unavailable'

/** The overlay renders one modal, or nothing. */
export interface EnrichmentEnableNoticeState {
  readonly open: boolean
}

/** The status subset the controller reads from the enrichment card store. */
export interface EnrichmentNamespaceStatusSource {
  getSnapshot(): { readonly namespaceStatus: EnrichmentNamespaceStatus }
  subscribe(listener: () => void): () => void
}

/** Where one client keeps its acknowledgement of the egress disclosure. */
export interface EnableNoticeAcknowledgement {
  /** Whether this client already acknowledged the disclosure. */
  read(): boolean
  /** Persist the acknowledgement for this client. */
  remember(): void
}

/**
 * The acknowledgement's storage key. The trailing version moves with the
 * disclosure's wording: a user who acknowledged an older text is owed the new
 * one.
 */
export const ENABLE_NOTICE_ACK_KEY = 'dsh-zotero:enrichment-egress-ack:1'

/**
 * The acknowledgement as this browser keeps it. `localStorage` can be absent
 * (a non-browser embedding) or refuse writes (a locked profile); both make the
 * notice show again rather than hide it, because a missing disclosure is the
 * failure that matters here.
 * @returns the acknowledgement port over this client's storage.
 */
export function clientAcknowledgement(): EnableNoticeAcknowledgement {
  return {
    read: () => {
      try {
        return localStorage.getItem(ENABLE_NOTICE_ACK_KEY) === '1'
      } catch {
        return false
      }
    },
    remember: () => {
      try {
        localStorage.setItem(ENABLE_NOTICE_ACK_KEY, '1')
      } catch {
        // A storage that refuses the write leaves the disclosure owed.
      }
    },
  }
}

/** State and dismissal bound into the `shell.overlay` entry. */
export interface EnrichmentEnableNoticeFace {
  readonly hooks: {
    readonly enrichmentEnableNotice: SnapshotStore<EnrichmentEnableNoticeState>
  }
  dismiss(): void
}

export class EnrichmentEnableNoticeController {
  private readonly store = createSnapshotStore<EnrichmentEnableNoticeState>({ open: false })
  private open = false
  private disposed = false
  private readonly unsubscribe: () => void

  constructor(
    private readonly source: EnrichmentNamespaceStatusSource,
    private readonly acknowledgement: EnableNoticeAcknowledgement = clientAcknowledgement(),
  ) {
    this.observe()
    this.unsubscribe = source.subscribe(() => {
      this.observe()
    })
  }

  /**
   * The notice is owed exactly while the component is served and this client
   * has not acknowledged the disclosure. `loading` says nothing yet, so the
   * state it was in stays; any other status decides.
   */
  private observe(): void {
    if (this.disposed) return
    const status = this.source.getSnapshot().namespaceStatus
    if (status === 'loading') return
    this.setOpen(status === 'ready' && !this.acknowledgement.read())
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return
    this.open = open
    this.store.set({ open })
  }

  /** Accept the disclosure: close it and remember the acceptance for this client. */
  dismiss(): void {
    if (this.disposed || !this.open) return
    this.acknowledgement.remember()
    this.setOpen(false)
  }

  inject(): EnrichmentEnableNoticeFace {
    return {
      hooks: { enrichmentEnableNotice: this.store },
      dismiss: () => {
        this.dismiss()
      },
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
  }
}
