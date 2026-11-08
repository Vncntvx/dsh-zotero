// @vitest-environment jsdom
/** Reading refusals stay visible and never open or download through a different route. */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mountPanel } from '../helpers/library-panel-harness.tsx'
import { fakeScope } from '../helpers/fake-scope.ts'
import { zoteroClientStub } from '../helpers/zotero-client.ts'
import { createLibraryPreferenceSource } from '../../../src/client/library-preferences.tsx'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { zh } from '../../../src/client/locales.ts'
import type { ZoteroLibraryPanelProps } from '../../../src/client/components/library/ZoteroLibraryPanel.tsx'
const sources: ReturnType<typeof createLibraryPreferenceSource>[] = []
function preferences(value: Record<string, unknown>) {
  const source = createLibraryPreferenceSource(
    fakeScope({ value }),
    fakeScope({ value: { defaultStyle: 'apa', defaultLocale: 'en-US' } }),
  )
  sources.push(source)
  return source
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  for (const source of sources.splice(0)) source.dispose()
})
it('shows a missing local PDF path without opening an empty reader', async () => {
  const { face } = mountPanel({
    resolveAttachment: vi.fn(async () => ({ ok: true, value: { kind: 'file', ref: 'ref' } })),
  })
  fireEvent.click(await screen.findByText('FlashAttention-2'))
  fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
  expect(await screen.findByText(zh.pdfFileNotFound)).toBeTruthy()
  expect(face.openResource).not.toHaveBeenCalled()
})
it('reports a refused Zotero launch without opening a browser reader', async () => {
  const openProtocol = vi.fn(async () => false)
  const { face } = mountPanel({}, undefined, {
    preferenceSource: preferences({ localPdfOpenTarget: 'zotero' }),
    useZoteroClient: () => zoteroClientStub({ openProtocol }),
  })
  fireEvent.click(await screen.findByText('FlashAttention-2'))
  fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
  expect(await screen.findByText(zh.libraryPdfReaderUnavailable)).toBeTruthy()
  expect(face.openResource).not.toHaveBeenCalled()
})
it('routes a PDF child row through the same accepted destination as the main reader', async () => {
  const { face } = mountPanel({}, undefined, {
    preferenceSource: preferences({ localPdfOpenTarget: 'float' }),
  })
  fireEvent.click(await screen.findByText('FlashAttention-2'))
  fireEvent.click(await screen.findByRole('button', { name: 'paper.pdf' }))
  await waitFor(() =>
    expect(face.openResource).toHaveBeenCalledWith(expect.any(String), { destination: 'float' }),
  )
})
it.each(['missing adapter', 'denied remote action'] as const)(
  'reports %s for URL reading without starting a download',
  async (reason) => {
    const readUrlPdf = vi.fn()
    const useRemoteAccess = ((action: string) =>
      reason === 'denied remote action'
        ? action !== 'zotero/readUrlPdf'
        : true) as ZoteroLibraryPanelProps['useRemoteAccess']
    const { face } = mountPanel(
      {
        resolveAttachment: vi.fn(async () => ({
          ok: true,
          value: {
            kind: 'url',
            ref: 'ref',
            title: 'paper.pdf',
            url: 'https://papers.example/paper.pdf',
          },
        })),
      },
      undefined,
      {
        preferenceSource: preferences({ allowUrlPdfRead: true }),
        useRemoteAccess,
        ...(reason === 'missing adapter' ? {} : { readUrlPdf }),
      },
    )
    fireEvent.click(await screen.findByText('FlashAttention-2'))
    fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
    expect(await screen.findByText(zh.libraryPdfReaderUnavailable)).toBeTruthy()
    expect(readUrlPdf).not.toHaveBeenCalled()
    expect(face.openResource).not.toHaveBeenCalled()
  },
)
it('shows a host download refusal without retaining a file lease', async () => {
  const trackPdf = vi.fn()
  const { face } = mountPanel(
    {
      resolveAttachment: vi.fn(async () => ({
        ok: true,
        value: {
          kind: 'url',
          ref: 'ref',
          title: 'paper.pdf',
          url: 'https://papers.example/paper.pdf',
        },
      })),
    },
    undefined,
    {
      preferenceSource: preferences({ allowUrlPdfRead: true }),
      readUrlPdf: async () => ({
        ok: false,
        error: new RemoteError('zotero/domain', 'Host download refused', {
          code: 'ZOTERO_URL_PDF_NETWORK',
        }),
      }),
      trackPdf,
    },
  )
  fireEvent.click(await screen.findByText('FlashAttention-2'))
  fireEvent.click(await screen.findByRole('button', { name: zh.readPdf }))
  expect(await screen.findByText('Host download refused')).toBeTruthy()
  expect(trackPdf).not.toHaveBeenCalled()
  expect(face.openResource).not.toHaveBeenCalled()
})
