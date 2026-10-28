// @vitest-environment jsdom
/**
 * The caller-selected button emphasis: the inspector's action row asks for a
 * primary read button, every other surface keeps the outline default.
 * @module tests/client/open/PdfReadButton.emphasis
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfReadButton } from '../../../src/client/components/open/PdfReadButton.tsx'
import { mockT } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

afterEach(cleanup)

describe('PdfReadButton emphasis', () => {
  it('renders outline by default', () => {
    render(<PdfReadButton filePath="/storage/test.pdf" onOpenFile={vi.fn()} t={mockT} />)
    const button = screen.getByRole('button', { name: mockT('readPdf') })
    expect(button.getAttribute('data-variant')).toBe('outline')
  })

  it('passes the caller emphasis through to the button', () => {
    render(
      <PdfReadButton
        filePath="/storage/test.pdf"
        onOpenFile={vi.fn()}
        emphasis="primary"
        t={mockT}
      />,
    )
    const button = screen.getByRole('button', { name: mockT('readPdf') })
    expect(button.getAttribute('data-variant')).toBe('primary')
  })
})
