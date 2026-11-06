/**
 * Shared browser-face stubs for client component specs: the root client face
 * and the session composer actions the library panel injects.
 * @module tests/client/helpers/zotero-client
 */

import { vi } from 'vitest'
import type { ZoteroClientFace } from '../../../src/client/actions/client-face.ts'

/** A successful Host-backed client face; individual specs override members they drive. */
export function zoteroClientStub(): ZoteroClientFace {
  return {
    reportClientError: vi.fn(async () => {}),
    openProtocol: vi.fn(async () => true),
    resolveAttachment: vi.fn(async (ref: string) => ({
      ok: true,
      value: {
        ref,
        kind: 'file',
        title: 'paper.pdf',
        contentType: 'application/pdf',
        path: '/tmp/paper.pdf',
      },
    })),
  } as unknown as ZoteroClientFace
}

/** The session composer face the library panel reads for quote/insert actions. */
export function inputActionsStub() {
  return {
    setDraft: vi.fn(),
    captureInsertion: vi.fn(() => ({ anchor: 0 })),
    insertText: vi.fn(() => true),
    insertQuote: vi.fn(() => true),
    submit: vi.fn(),
  }
}
