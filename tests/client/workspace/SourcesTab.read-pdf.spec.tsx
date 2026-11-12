// @vitest-environment jsdom
/**
 * The SourcesTab readPdf integration: resolving file attachments to local addresses,
 * handling URL PDF downloads under user preferences, tracking reader leases, and
 * cleanup on open failures.
 * @module tests/client/workspace/SourcesTab.read-pdf
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesTab, type SourcesTabProps } from '../../../src/client/components/SourcesTab.tsx'
import { passageOf, sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { sessionOf, sessionsOf } from '../helpers/sources-tab-harness.tsx'
import { statusView } from '../../helpers/status-view.ts'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { zoteroClientStub } from '../helpers/zotero-client.ts'
import { mockT } from '../helpers/mock-translate.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function mountAndSettle(props: Partial<SourcesTabProps> = {}) {
  const item = sourceOf({
    key: 'item-1',
    ref: 'zotero://user/0/item/ITEM1',
    evidence: [passageOf({ attachmentRef: 'zotero://user/0/item/ATT1' })],
    retrievalFacts: {
      truncated: false,
      sourceAvailability: {},
      attachmentRef: 'zotero://user/0/item/ATT1',
    },
  })
  const workspace = workspaceOf([item])
  const baseProps = {
    t,
    status: async () => ({
      ok: true,
      value: statusView({
        apiVersion: '3',
        schemaVersion: '37',
        serverId: 'sPMHtLD6HHBd',
        diagnosis: 'ok',
        sourceProjection: { state: 'ready' },
      }),
    }),
    useSession: (sel: (snap: ReturnType<typeof sessionOf>) => unknown) => sel(sessionOf()),
    useSessions: (sel: (snapshot: ReturnType<typeof sessionsOf>) => unknown) => sel(sessionsOf()),
    useChat: () => undefined,
    useProjection: () => workspace,
    useRemoteAccess: () => true,
    useAccess: () => true,
    useZoteroClient: () => zoteroClientStub(),
    ...props,
  } as unknown as SourcesTabProps

  const view = render(<SourcesTab {...baseProps} />)
  await act(async () => {})
  return view
}

describe('SourcesTab readPdf flow', () => {
  it('opens a local file attachment in the resource viewer', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'file', path: 'papers/attention.pdf' },
    })

    await mountAndSettle({ openResource, resolveAttachment })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(resolveAttachment).toHaveBeenCalledWith('zotero://user/0/item/ATT1')
    expect(openResource).toHaveBeenCalledWith(expect.stringContaining('papers/attention.pdf'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('alerts when local file path is missing from resolved attachment', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'file', path: undefined },
    })

    await mountAndSettle({ openResource, resolveAttachment })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(screen.getByRole('alert').textContent).toContain(t('pdfFileNotFound'))
    expect(openResource).not.toHaveBeenCalled()
  })

  it('alerts when attachment resolution fails', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: false,
      error: new RemoteError('zotero/no-attachment', 'Attachment lookup failed', {
        code: 'ZOTERO_NO_ATTACHMENT',
      }),
    })

    await mountAndSettle({ openResource, resolveAttachment })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(screen.getByRole('alert').textContent).toContain('Attachment lookup failed')
    expect(openResource).not.toHaveBeenCalled()
  })

  it('refuses URL PDF reading when disabled by library preferences', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'url', url: 'https://arxiv.org/pdf/1706.03762' },
    })
    const libraryPreferences = () => ({ ...LIBRARY_DEFAULTS, allowUrlPdfRead: false })

    await mountAndSettle({ openResource, resolveAttachment, libraryPreferences })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(screen.getByRole('alert').textContent).toContain(t('libraryUrlPdfDisabled'))
    expect(openResource).not.toHaveBeenCalled()
  })

  it('alerts when URL PDF reader capability or hooks are absent', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'url', url: 'https://arxiv.org/pdf/1706.03762' },
    })
    const libraryPreferences = () => ({ ...LIBRARY_DEFAULTS, allowUrlPdfRead: true })

    await mountAndSettle({
      openResource,
      resolveAttachment,
      libraryPreferences,
      readUrlPdf: undefined,
    })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(screen.getByRole('alert').textContent).toContain(t('libraryPdfReaderUnavailable'))
  })

  it('downloads URL PDF, registers lease tracking, and opens resource', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'url', url: 'https://arxiv.org/pdf/1706.03762' },
    })
    const libraryPreferences = () => ({ ...LIBRARY_DEFAULTS, allowUrlPdfRead: true })
    const readUrlPdf = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        path: 'downloads/attention.pdf',
        lease: 'lease-123',
        ref: 'zotero://user/0/item/ATT1',
      },
    })
    const trackPdf = vi.fn()

    await mountAndSettle({
      openResource,
      resolveAttachment,
      libraryPreferences,
      readUrlPdf,
      trackPdf,
    })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(readUrlPdf).toHaveBeenCalledWith({ ref: 'zotero://user/0/item/ATT1' })
    expect(trackPdf).toHaveBeenCalledWith(
      expect.stringContaining('downloads/attention.pdf'),
      'lease-123',
      'zotero://user/0/item/ATT1',
    )
    expect(openResource).toHaveBeenCalledWith(expect.stringContaining('downloads/attention.pdf'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cleans up tracked lease when openResource throws an error', async () => {
    const openResource = vi.fn(() => {
      throw new Error('Viewer window could not open')
    })
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'url', url: 'https://arxiv.org/pdf/1706.03762' },
    })
    const libraryPreferences = () => ({ ...LIBRARY_DEFAULTS, allowUrlPdfRead: true })
    const readUrlPdf = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        path: 'downloads/attention.pdf',
        lease: 'lease-999',
        ref: 'zotero://user/0/item/ATT1',
      },
    })
    const trackPdf = vi.fn()
    const forgetPdf = vi.fn()
    const releaseUrlPdf = vi.fn().mockResolvedValue(undefined)

    await mountAndSettle({
      openResource,
      resolveAttachment,
      libraryPreferences,
      readUrlPdf,
      trackPdf,
      forgetPdf,
      releaseUrlPdf,
    })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(forgetPdf).toHaveBeenCalledWith(expect.stringContaining('downloads/attention.pdf'))
    expect(releaseUrlPdf).toHaveBeenCalledWith('lease-999')
    expect(screen.getByRole('alert').textContent).toContain('Viewer window could not open')
  })

  it('alerts when readUrlPdf returns an error', async () => {
    const openResource = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: { kind: 'url', url: 'https://arxiv.org/pdf/1706.03762' },
    })
    const libraryPreferences = () => ({ ...LIBRARY_DEFAULTS, allowUrlPdfRead: true })
    const readUrlPdf = vi.fn().mockResolvedValue({
      ok: false,
      error: new RemoteError('zotero/url-pdf', 'PDF fetch timed out', {
        code: 'ZOTERO_URL_PDF_TIMEOUT',
      }),
    })
    const trackPdf = vi.fn()

    await mountAndSettle({
      openResource,
      resolveAttachment,
      libraryPreferences,
      readUrlPdf,
      trackPdf,
    })
    const jumpBtn = screen.getByRole('button', { name: t('jumpToPageInSidebar') })
    await act(async () => {
      fireEvent.click(jumpBtn)
    })

    expect(screen.getByRole('alert').textContent).toContain('PDF fetch timed out')
    expect(trackPdf).not.toHaveBeenCalled()
    expect(openResource).not.toHaveBeenCalled()
  })
})
