// @vitest-environment jsdom
/** An attachment resolver never grants browser navigation to executable or credential URLs. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PdfReadButton } from '../../../src/client/components/open/PdfReadButton.tsx'
import { mockT } from '../helpers/mock-translate.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it.each([
  'javascript:alert(1)',
  'data:text/html,attack',
  'file:///tmp/private.pdf',
  'https://user:secret@example.org/paper.pdf',
])('refuses a direct unsafe PDF destination: %s', async (webUrl) => {
  const open = vi.fn()
  const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<PdfReadButton webUrl={webUrl} onOpenUrl={open} t={mockT} />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button'))
  })
  expect(open).not.toHaveBeenCalled()
  expect(windowOpen).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain(mockT('readErrorUrlBlocked'))
})

it.each(['javascript:alert(1)', 'https://user:secret@example.org/paper.pdf'])(
  'refuses an unsafe destination returned by the remote resolver: %s',
  async (url) => {
    const open = vi.fn()
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/ABCD1234"
        onOpenUrl={open}
        resolveAttachment={async () => ({
          ok: true,
          value: {
            ref: 'zotero://user/0/item/ABCD1234',
            kind: 'url',
            url,
            title: 'paper.pdf',
            contentType: 'application/pdf',
          },
        })}
        t={mockT}
      />,
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(open).not.toHaveBeenCalled()
    expect(windowOpen).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain(mockT('readErrorUrlBlocked'))
  },
)
