/**
 * Disclosure state for the moment the enrichment component is switched on.
 *
 * The enrichment form reports `loading` until settings settle, `ready` while
 * the component is served, and `unavailable` while it is not. The first
 * settled status is a baseline, so a component already enabled at boot shows
 * nothing. A later `unavailable` to `ready` transition opens the disclosure;
 * dismissal is scoped to that serving, so disabling and re-enabling the
 * component shows it again. The form store is the only input.
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

/** State and dismissal bound into the `shell.overlay` entry. */
export interface EnrichmentEnableNoticeFace {
  readonly hooks: {
    readonly enrichmentEnableNotice: SnapshotStore<EnrichmentEnableNoticeState>
  }
  dismiss(): void
}

export class EnrichmentEnableNoticeController {
  private readonly store = createSnapshotStore<EnrichmentEnableNoticeState>({ open: false })
  private settled = false
  private served = false
  private disposed = false
  private readonly unsubscribe: () => void

  constructor(private readonly source: EnrichmentNamespaceStatusSource) {
    this.observe()
    this.unsubscribe = source.subscribe(() => {
      this.observe()
    })
  }

  /** Open the notice on an unavailable → ready transition after the baseline. */
  private observe(): void {
    if (this.disposed) return
    const status = this.source.getSnapshot().namespaceStatus
    if (status === 'loading') return
    const served = status === 'ready'
    if (!this.settled) {
      this.settled = true
      this.served = served
      return
    }
    if (served === this.served) return
    this.served = served
    this.store.set({ open: served })
  }

  dismiss(): void {
    if (this.disposed || !this.store.getSnapshot().open) return
    this.store.set({ open: false })
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
