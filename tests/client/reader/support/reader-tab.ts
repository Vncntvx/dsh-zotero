import type { ReactNode } from 'react'
import { vi } from 'vitest'
import type { ReaderTab, ReaderTabFace } from '../../../../src/client/reader/ReaderTab.tsx'
import { readerAddress } from '../../../../src/client/reader/address.ts'
import { readerZh } from '../../../../src/client/reader/locales.ts'
import { emptyVisits } from '../../../../src/client/reader/reading-history.ts'
import type { mountPdf as mountPdfRuntime } from '../../../../src/client/reader/pdf-runtime.ts'
import { makeTranslate } from '../../helpers/mock-translate.ts'

export const SESSION = 'session-1'
export const REF = 'zotero://user/0/attachment/ABCD1234'
const SIGNAL = new AbortController().signal
export const t = makeTranslate(readerZh)

/** A mount Pdf runtime stub: enough controls for the effect to finish loading. */
export function pdfRuntime(
  selection?: import('../../../../src/client/reader/pdf-runtime.ts').PdfSelection,
  view: Partial<
    Pick<
      import('../../../../src/client/reader/pdf-runtime.ts').PdfView,
      'page' | 'count' | 'label' | 'sectionTitle' | 'fingerprint'
    >
  > = {},
) {
  const controls = {
    dispose: vi.fn(),
    getOutline: vi
      .fn<Awaited<ReturnType<typeof mountPdfRuntime>>['getOutline']>()
      .mockResolvedValue([]),
    setEvidence: vi.fn(),
    locateEvidence: vi.fn<Awaited<ReturnType<typeof mountPdfRuntime>>['locateEvidence']>(),
    artifactPosition: vi.fn<Awaited<ReturnType<typeof mountPdfRuntime>>['artifactPosition']>(),
    artifactSelection: vi.fn<Awaited<ReturnType<typeof mountPdfRuntime>>['artifactSelection']>(),
    setAnnotations: vi.fn(),
    setSelectedAnnotation: vi.fn(),
    goTo: vi.fn(),
    goToOutline: vi.fn(async () => undefined),
    zoom: vi.fn(),
    fit: vi.fn(),
    rotate: vi.fn(),
    find: vi.fn(),
    capture: vi.fn(),
    readExcerpt: vi.fn<Awaited<ReturnType<typeof mountPdfRuntime>>['readExcerpt']>(),
    pageLabel: vi.fn((pageIndex: number) => String(pageIndex + 1)),
  }
  let surface: HTMLElement | undefined
  const mountPdf = vi.fn<typeof mountPdfRuntime>(async (...args) => {
    surface = args[0]
    args[3]({ page: 1, count: 1, fingerprint: 'fingerprint', ...view })
    args[4]?.restore('fingerprint')
    if (selection) args[5]?.onSelection?.(selection)
    return controls
  })
  /** The element the PDF viewer mounted into: the page surface of the reader. */
  const page = () => surface
  return { mountPdf, controls, page }
}

/**
 * Build the slot props with a faithful TabRecord: the address lives under
 * `tab.navigation`, and there is deliberately no `sessionId` on `tab` — the
 * session identity arrives only as the standard `sessionId` prop.
 */
export function propsOf(
  overrides: Partial<ReaderTabFace> = {},
  address = readerAddress(SESSION, REF),
) {
  const face: ReaderTabFace = {
    resolve: vi.fn(async () => ({ path: 'papers/paper.pdf', ref: REF })),
    read: vi.fn(async () => new Uint8Array()),
    readTextAttachment: vi.fn(),
    load: () => Promise.resolve(pdfRuntime()),
    openProtocol: vi.fn(async () => true),
    history: {
      visits: emptyVisits,
      save: vi.fn(),
      restore: vi.fn(() => undefined),
    } as unknown as ReaderTabFace['history'],
    details: vi.fn(),
    readNote: vi.fn(),
    translate: vi.fn(),
    writeNote: vi.fn(),
    annotations: vi.fn<ReaderTabFace['annotations']>(async () => ({
      items: [],
      total: 0,
      returned: 0,
      limit: 50,
      offset: 0,
      writeEnabled: false,
    })),
    updateAnnotation: vi.fn<ReaderTabFace['updateAnnotation']>(async () => ({
      kind: 'applied',
      message: 'Saved',
    })),
    createAnnotations: vi.fn<ReaderTabFace['createAnnotations']>(async () => ({
      kind: 'declined',
    })),
    deleteAnnotation: vi.fn<ReaderTabFace['deleteAnnotation']>(async () => ({
      kind: 'declined',
      message: 'Declined',
    })),
    ...overrides,
  }
  return {
    sessionId: SESSION,
    t,
    useTabInfo: () => ({
      tab: {
        id: 'tab-1',
        kind: 'zotero-reader',
        contentId: address,
        title: 'Paper',
        navigation: { address, params: {}, revision: 0 },
        visible: true,
        signal: SIGNAL,
        actions: {},
      },
    }),
    useRemoteAccess: () => true,
    useAccess: () => true,
    useSession: (
      select: (session: {
        removed: boolean
        running: boolean
        subagent: null
        openState: 'open'
        blank: boolean
      }) => unknown,
    ) =>
      select({ removed: false, running: false, subagent: null, openState: 'open', blank: false }),
    renderSlot: (_name: string, _opts: unknown, _fallback?: ReactNode) => null,
    ...face,
  } as unknown as Parameters<typeof ReaderTab>[0]
}
