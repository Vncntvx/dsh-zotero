// @vitest-environment jsdom
/**
 * The protocol-failure notice entry: no notice renders nothing; a notice
 * renders the localized warning banner and clears through its dismissal.
 * @module tests/client/ZoteroToast
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroToast, type ZoteroToastProps } from '../../src/client/components/ZoteroToast.tsx'
import { mockT } from './helpers/mock-translate.ts'

afterEach(cleanup)

function renderToast(notice: { readonly seq: number } | null, dismiss: () => void = vi.fn()) {
  const props = {
    t: mockT,
    useToast: <T,>(select: (value: typeof notice) => T) => select(notice),
    dismiss,
  } as unknown as ZoteroToastProps
  return render(<ZoteroToast {...props} />)
}

describe('ZoteroToast', () => {
  it('renders nothing without a notice', () => {
    const { container } = renderToast(null)
    expect(container.innerHTML).toBe('')
  })

  it('renders the localized protocol failure as an alert', () => {
    renderToast({ seq: 1 })
    expect(screen.getByRole('alert').textContent).toContain(mockT('openInZoteroFailed'))
  })
})
