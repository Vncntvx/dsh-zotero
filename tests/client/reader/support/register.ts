import type { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { beforeEach, vi } from 'vitest'
import type { ZoteroAttachmentLocationView } from '../../../../src/contract.ts'
import { loadReaderPdf, loadReaderTab } from '../../../../src/client/reader/load-chunks.ts'
import { registerReader } from '../../../../src/client/reader/register.ts'
import { readerEn, readerZh } from '../../../../src/client/reader/locales.ts'
import type { ReaderTabFace } from '../../../../src/client/reader/ReaderTab.tsx'
import type { ResolvedReaderConfig } from '../../../../src/reader/config.ts'

vi.mock('../../../../src/client/reader/load-chunks.ts', () => ({
  loadReaderPdf: vi.fn(),
  loadReaderTab: vi.fn(),
}))

export const SESSION = SessionId('reader-session')
export const REF = 'zotero://user/0/attachment/ABCD1234?server=instance-a'
export const ATTACHMENT = {
  ref: REF,
  title: 'A research paper',
  kind: 'file',
  path: 'tests/paper.pdf',
  contentType: 'application/pdf',
} satisfies ZoteroAttachmentLocationView
export const SIGNAL = new AbortController().signal
export const runtime = { mountPdf: vi.fn() }
export const loadPdf = vi.mocked(loadReaderPdf)
export const loadTab = vi.mocked(loadReaderTab)

beforeEach(() => {
  loadPdf.mockReset().mockResolvedValue(runtime)
  loadTab.mockReset().mockResolvedValue({
    ReaderTab: () => createElement('div'),
    ReaderNoteMutation: () => createElement('form'),
    ReaderTurnCitations: () => createElement('details'),
    readerEn,
    readerZh,
  })
})

export function register(served = true) {
  let dispose = () => {}
  const closeLocale = vi.fn()
  const registerLocale = vi.fn(() => closeLocale)
  const closeTab = vi.fn()
  const closeSlot = vi.fn()
  const openResourceIn = vi.fn()
  const readAccess = vi.fn(() => true)
  const bytes = new Uint8Array([1, 2, 3])
  const readBytes = vi
    .fn()
    .mockResolvedValue({ ok: true, value: { offset: 0, eof: true, data: bytes } })
  const zotero = {
    resolveAttachment: vi.fn().mockResolvedValue({ ok: true, value: ATTACHMENT }),
    documentArtifact: vi.fn(),
    readerAnnotations: vi.fn(),
    readerDetails: vi.fn(),
    readerNote: vi.fn(),
    readerTranslate: vi.fn(),
    readerSuggestAnnotation: vi.fn(),
    readerWriteNote: vi.fn(),
    readerUpdateAnnotation: vi.fn(),
    readerDeleteAnnotation: vi.fn(),
    readerCreateAnnotations: vi.fn(),
    openProtocol: vi.fn(),
  }
  const registerSlot = vi.fn()
  const config = createSnapshotStore<{ value?: ResolvedReaderConfig }>({})
  const ctx = {
    inject: (_deps: unknown, mount: (scope: unknown) => void) => mount(ctx),
    effect: (mount: () => typeof dispose) => {
      dispose = mount()
    },
    configForms: {
      whileServed: (_namespaces: unknown, mount: () => typeof dispose) =>
        served ? mount() : () => {},
      get: () => config,
    },
    locale: { register: registerLocale, bind: () => (key: string) => key },
    remote: { zotero, workspaceFiles: { readBytes } },
    remoteAccess: { source: () => ({ getSnapshot: readAccess }) },
    sidebarRightTabs: { register: () => closeTab },
    sidebarRight: { openResourceIn },
    slots: {
      inject: (_slot: string, mount: () => void) => {
        mount()
        return closeSlot
      },
      register: registerSlot,
    },
  }
  const { open, openNote, visits } = registerReader(ctx as unknown as Context)
  const face = registerSlot.mock.calls[0]?.[0]?.inject() as ReaderTabFace | undefined
  const citations = registerSlot.mock.calls
    .find(([slot]) => slot.id === 'zotero.readerCitations')?.[0]
    ?.inject()
  return {
    open,
    openNote,
    visits,
    face,
    citations,
    config,
    dispose,
    openResourceIn,
    readAccess,
    closeLocale,
    registerLocale,
    closeTab,
    closeSlot,
    bytes,
    readBytes,
    zotero,
    registerSlot,
  }
}
