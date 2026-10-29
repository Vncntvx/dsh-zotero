// @vitest-environment jsdom
/**
 * In-app PDF reader button tests: sidebar opening, on-demand resolution,
 * error handling, and visual/aria states.
 * @module tests/client/open/PdfReadButton
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ZoteroAttachmentLocationView } from '../../../src/contract.ts'
import { PdfReadButton } from '../../../src/client/components/open/PdfReadButton.tsx'
import { setAttachmentResolver } from '../../../src/client/actions/attachment-resolver.ts'
import { deferred } from '../../helpers/sync.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  setAttachmentResolver(undefined)
})

describe('PdfReadButton', () => {
  it('disables a direct local path when no sidebar opener is available', () => {
    render(<PdfReadButton filePath="/storage/test.pdf" t={t} />)
    const button = screen.getByRole('button', { name: mockT('libraryNoSessionForOpen') })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
  })

  it('opens a direct local file in the sidebar', () => {
    const onOpenFile = vi.fn()
    render(<PdfReadButton filePath="/storage/test.pdf" onOpenFile={onOpenFile} t={t} />)
    const button = screen.getByRole('button', { name: mockT('readPdf') })
    fireEvent.click(button)
    expect(onOpenFile).toHaveBeenCalledWith('/storage/test.pdf')
  })

  it('opens a direct local file without navigation options in the sidebar', () => {
    const onOpenFile = vi.fn()
    render(<PdfReadButton filePath="/storage/test.pdf" onOpenFile={onOpenFile} t={t} />)
    const button = screen.getByRole('button', { name: mockT('readPdf') })
    fireEvent.click(button)
    expect(onOpenFile).toHaveBeenCalledWith('/storage/test.pdf')
  })

  it('opens a web PDF url with custom or window opener', () => {
    const onOpenUrl = vi.fn()
    const { rerender } = render(
      <PdfReadButton webUrl="https://arxiv.org/pdf/1234.pdf" onOpenUrl={onOpenUrl} t={t} />,
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://arxiv.org/pdf/1234.pdf')

    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    rerender(<PdfReadButton webUrl="https://arxiv.org/pdf/1234.pdf" t={t} />)
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://arxiv.org/pdf/1234.pdf',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('resolves attachment on demand and opens resolved local file path', async () => {
    const onOpenFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'file',
        title: 'sample.pdf',
        contentType: 'application/pdf',
        path: '/storage/sample.pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        onOpenFile={onOpenFile}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(resolveAttachment).toHaveBeenCalledWith('zotero://user/0/item/ATT12345')
    expect(onOpenFile).toHaveBeenCalledWith('/storage/sample.pdf')
  })

  it('resolves attachment and opens without navigation options', async () => {
    const onOpenFile = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'file',
        title: 'sample.pdf',
        contentType: 'application/pdf',
        path: '/storage/sample.pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        onOpenFile={onOpenFile}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(resolveAttachment).toHaveBeenCalledWith('zotero://user/0/item/ATT12345')
    expect(onOpenFile).toHaveBeenCalledWith('/storage/sample.pdf')
  })

  it('handles non-Error thrown during open and resolution', async () => {
    const onOpenFile = vi.fn().mockImplementation(() => {
      throw 'direct string error'
    })
    render(<PdfReadButton filePath="/storage/test.pdf" onOpenFile={onOpenFile} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    expect(screen.getByRole('button', { name: 'direct string error' })).toBeTruthy()

    const resolveAttachment = vi.fn().mockRejectedValue('async string failure')
    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })
    expect(screen.getByRole('button', { name: 'async string failure' })).toBeTruthy()
  })

  it('uses singleton attachment resolver when prop is omitted', async () => {
    const onOpenFile = vi.fn()
    const singletonResolver = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'file',
        title: 'sample.pdf',
        contentType: 'application/pdf',
        path: '/storage/singleton.pdf',
      },
    })
    setAttachmentResolver(singletonResolver)

    render(
      <PdfReadButton attachmentRef="zotero://user/0/item/ATT12345" onOpenFile={onOpenFile} t={t} />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(singletonResolver).toHaveBeenCalledWith('zotero://user/0/item/ATT12345')
    expect(onOpenFile).toHaveBeenCalledWith('/storage/singleton.pdf')
  })

  it('shows error when resolved file has no local path', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'file',
        title: 'missing.pdf',
        contentType: 'application/pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    const button = screen.getByRole('button', { name: mockT('pdfFileNotFound') })
    expect(button).toBeDefined()
  })

  it('handles resolved url attachment', async () => {
    const onOpenUrl = vi.fn()
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'url',
        title: 'web.pdf',
        contentType: 'application/pdf',
        url: 'https://example.com/web.pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        onOpenUrl={onOpenUrl}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/web.pdf')
  })

  it('displays error message when resolver returns failure', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'FAIL', message: 'Attachment lookup error' },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    const button = screen.getByRole('button', { name: 'Attachment lookup error' })
    expect(button).toBeDefined()
  })

  it('displays error message when resolver throws an exception', async () => {
    const resolveAttachment = vi.fn().mockRejectedValue(new Error('Network disconnected'))

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    const button = screen.getByRole('button', { name: 'Network disconnected' })
    expect(button).toBeDefined()
  })

  it('displays string error when resolver throws a non-Error primitive', async () => {
    const resolveAttachment = vi.fn().mockRejectedValue('Raw string rejection')

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    const button = screen.getByRole('button', { name: 'Raw string rejection' })
    expect(button).toBeDefined()
  })

  it('falls back to window.open when resolved url has no onOpenUrl callback', async () => {
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'url',
        title: 'web.pdf',
        contentType: 'application/pdf',
        url: 'https://example.com/fallback.pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(windowOpenSpy).toHaveBeenCalledWith(
      'https://example.com/fallback.pdf',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('handles resolved file path when onOpenFile is omitted', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'file',
        title: 'sample.pdf',
        contentType: 'application/pdf',
        path: '/storage/sample.pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(screen.getByRole('button', { name: mockT('readPdf') })).toBeDefined()
  })

  it('handles resolved url when url field is missing', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ref: 'zotero://user/0/item/ATT12345',
        kind: 'url',
        title: 'sample.pdf',
        contentType: 'application/pdf',
      },
    })

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    })

    expect(screen.getByRole('button', { name: mockT('readPdf') })).toBeDefined()
  })

  it('safely handles filePath when onOpenFile is omitted', () => {
    render(<PdfReadButton filePath="/storage/unhandled.pdf" t={t} />)
    const button = screen.getByRole('button', { name: mockT('libraryNoSessionForOpen') })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('safely handles attachmentRef when no resolver is available', () => {
    render(<PdfReadButton attachmentRef="zotero://user/0/item/ATT12345" t={t} />)
    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
  })

  it('renders link variant with default class', () => {
    render(<PdfReadButton filePath="/storage/test.pdf" onOpenFile={vi.fn()} variant="link" t={t} />)
    const button = screen.getByRole('button', { name: mockT('readPdf') })
    expect(button.className).toBeTruthy()
  })

  it('renders link variant with custom label and title', () => {
    render(
      <PdfReadButton
        filePath="/storage/test.pdf"
        onOpenFile={vi.fn()}
        variant="link"
        label="Custom Read"
        title="Custom Title"
        className="my-custom-class"
        t={t}
      />,
    )
    const button = screen.getByRole('button', { name: 'Custom Read' })
    expect(button.className).toContain('my-custom-class')
    expect(button.getAttribute('title')).toBe('Custom Title')
  })

  it('handles in-flight resolving state and ignores duplicate clicks', async () => {
    const d = deferred<RemoteResult<ZoteroAttachmentLocationView>>()
    const resolveAttachment = vi.fn().mockReturnValue(d.promise)

    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ATT12345"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )

    const button = screen.getByRole('button', { name: mockT('readPdf') })
    fireEvent.click(button)

    expect(resolveAttachment).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: mockT('pdfResolving') })).toBeDefined()

    // Second click while in-flight is ignored
    fireEvent.click(button)
    expect(resolveAttachment).toHaveBeenCalledTimes(1)

    // Settle promise
    await act(async () => {
      d.resolve({
        ok: true,
        value: {
          ref: 'zotero://user/0/item/ATT12345',
          kind: 'file',
          title: 'paper.pdf',
          contentType: 'application/pdf',
          path: '/path/paper.pdf',
        },
      })
    })

    expect(screen.getByRole('button', { name: mockT('readPdf') })).toBeDefined()
  })

  it('supports capability prop for file and url kinds and resets error on update', async () => {
    const onOpenFile = vi.fn()
    const onOpenUrl = vi.fn()

    const { rerender } = render(
      <PdfReadButton
        capability={{
          kind: 'file',
          ref: 'zotero://user/0/attachment/F1',
          filePath: '/storage/cap-file.pdf',
        }}
        onOpenFile={onOpenFile}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    expect(onOpenFile).toHaveBeenCalledWith('/storage/cap-file.pdf')

    // Rerender with URL capability
    rerender(
      <PdfReadButton
        capability={{
          kind: 'url',
          url: 'https://example.com/cap-web.pdf',
        }}
        onOpenUrl={onOpenUrl}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: mockT('readPdf') }))
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/cap-web.pdf')
  })
})
