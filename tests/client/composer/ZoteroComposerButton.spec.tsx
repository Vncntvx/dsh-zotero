// @vitest-environment jsdom
/**
 * Zotero composer toolbar button test suite.
 * @module tests/client/composer/ZoteroComposerButton
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroComposerButton } from '../../../src/client/components/composer/ZoteroComposerButton.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ZoteroComposerButton', () => {
  it('renders with accessible name matching tabLibrary', () => {
    render(<ZoteroComposerButton t={t} />)
    const button = screen.getByRole('button', { name: mockT('tabLibrary') })
    expect(button).toBeDefined()
    expect(button.getAttribute('title')).toBe(mockT('tabLibrary'))
  })

  it('invokes onClick callback when clicked', () => {
    const handleClick = vi.fn()
    render(<ZoteroComposerButton t={t} onClick={handleClick} />)
    const button = screen.getByRole('button', { name: mockT('tabLibrary') })
    fireEvent.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
