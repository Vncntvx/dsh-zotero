/**
 * Shared browser-face stubs for client component specs: the complete
 * ZoteroClientFace and the session composer actions the library panel injects.
 * @module tests/client/helpers/zotero-client
 */

import { vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ZoteroAttachmentLocationView } from '../../../src/contract.ts'
import type {
  ZoteroClientFace,
  ZoteroProtocolNotice,
} from '../../../src/client/actions/client-face.ts'

/**
 * A successful Host-backed client face; individual specs override members they
 * drive, and `initialNotice` seeds the protocol notice so a spec can assert
 * the dismisser clears it.
 */
export function zoteroClientStub(
  overrides: Partial<ZoteroClientFace> = {},
  initialNotice: ZoteroProtocolNotice | null = null,
): ZoteroClientFace {
  const notice = createSnapshotStore<ZoteroProtocolNotice | null>(initialNotice)
  /** The notice in use: an override may replace the store's observable. */
  const shown = overrides.protocolNotice ?? notice
  const dismiss = (): void => {
    // A spec that overrode the observable may still hand back a snapshot
    // store; clearing it is the only correct dismissal. A bare observable has
    // no clear path, so the dismisser is a no-op there.
    const store = shown as unknown as { set?: (next: null) => void }
    if (typeof store.set === 'function') store.set(null)
  }
  const resolveAttachment = async (
    ref: string,
  ): Promise<RemoteResult<ZoteroAttachmentLocationView>> => ({
    ok: true,
    value: {
      ref,
      kind: 'file',
      title: 'paper.pdf',
      contentType: 'application/pdf',
      path: '/tmp/paper.pdf',
    },
  })
  return {
    reportClientError: overrides.reportClientError ?? vi.fn(async () => {}),
    openProtocol: overrides.openProtocol ?? vi.fn(async () => true),
    resolveAttachment: overrides.resolveAttachment ?? vi.fn(resolveAttachment),
    protocolNotice: shown,
    dismissProtocolNotice: overrides.dismissProtocolNotice ?? dismiss,
  }
}

/** The session composer face the library panel reads for quote/insert actions. */
export function inputActionsStub() {
  return {
    setDraft: vi.fn(),
    persistDraft: vi.fn(),
    captureInsertion: vi.fn(() => ({ anchor: 0 })),
    insertText: vi.fn(() => true),
    insertQuote: vi.fn(() => true),
    submit: vi.fn(),
  }
}
