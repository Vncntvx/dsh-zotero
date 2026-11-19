/**
 * One component's namespace status as a real snapshot store.
 *
 * The enable-notice specs used to hand-build the same `getSnapshot/subscribe/
 * publish` store twice. `createSnapshotStore` is the store the client itself
 * uses, so a shared source keeps those specs on the production contract.
 * @module tests/client/helpers/namespace-status-source
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { NamespaceStatus } from '../../../src/client/helpers/namespace-status.ts'

/** The source handle a notice controller subscribes to. */
export interface NamespaceStatusSourceHandle {
  getSnapshot(): { readonly namespaceStatus: NamespaceStatus }
  subscribe(listener: () => void): () => void
  publish(status: NamespaceStatus): void
}

/**
 * @param initial - the status the component starts in (default `loading`).
 * @returns a source whose `publish` replaces the snapshot and notifies.
 */
export function namespaceStatusSourceOf(
  initial: NamespaceStatus = 'loading',
): NamespaceStatusSourceHandle {
  const store = createSnapshotStore<{ readonly namespaceStatus: NamespaceStatus }>({
    namespaceStatus: initial,
  })
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
    publish: (status) => store.set({ namespaceStatus: status }),
  }
}
