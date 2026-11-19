// @vitest-environment jsdom
/**
 * Two small tooltip-button states introduced by the design pass: a disabled
 * copy button keeps a hover seat, and a resolving PDF read button swaps its
 * icon for a progress dot while the location request is in flight.
 * @module tests/client/components/copy-and-read-states
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from '../../../src/client/components/CopyButton.tsx'
import { PdfReadButton } from '../../../src/client/components/open/PdfReadButton.tsx'
import { deferred } from '../../helpers/sync.ts'
import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('tooltip-button states', () => {
  it('keeps a disabled copy button inside its tooltip seat', () => {
    render(<CopyButton value="x" label="Copy ref" copiedLabel="Copied" title="Why" disabled />)
    const button = screen.getByRole('button', { name: 'Copy ref' })
    expect(button).toHaveProperty('disabled', true)
    expect(button.parentElement?.className).toContain('seat')
  })

  it('shows the progress dot while the attachment location resolves', async () => {
    const pending = deferred<never>()
    const resolveAttachment = vi.fn(async () => await pending.promise)
    render(
      <PdfReadButton
        attachmentRef="zotero://user/0/item/RESOLV0001"
        resolveAttachment={resolveAttachment}
        t={t}
      />,
    )
    const button = screen.getByRole('button', { name: t('readPdf') })
    fireEvent.click(button)
    await act(async () => {})
    expect(button.getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      pending.reject(new Error('offline'))
    })
    expect(button.getAttribute('aria-busy')).toBeNull()
  })
})
