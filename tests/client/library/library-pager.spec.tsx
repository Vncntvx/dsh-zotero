// @vitest-environment jsdom
/**
 * LibraryPager component unit test suite.
 * @module tests/client/library/library-pager
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryPager } from '../../../src/client/components/library/LibraryPager.tsx'

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

describe('LibraryPager', () => {
  it('renders range and handles pagination clicks when returned > 0', () => {
    const onPage = vi.fn()
    render(
      <LibraryPager
        t={t}
        label="Test Pager"
        offset={20}
        limit={20}
        total={100}
        returned={20}
        nextOffset={40}
        onPage={onPage}
      />,
    )

    // Previous button should page back
    const prevBtn = screen.getByRole('button', { name: mockT('libraryPagePrev') })
    expect(prevBtn).toBeDefined()
    expect(prevBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(prevBtn)
    expect(onPage).toHaveBeenCalledWith(0)

    // Next button should page forward
    const nextBtn = screen.getByRole('button', { name: mockT('libraryPageNext') })
    expect(nextBtn).toBeDefined()
    expect(nextBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(nextBtn)
    expect(onPage).toHaveBeenCalledWith(40)
  })

  it('renders empty range (0..0) when returned is 0', () => {
    const onPage = vi.fn()
    render(
      <LibraryPager
        t={t}
        label="Test Pager"
        offset={0}
        limit={20}
        total={0}
        returned={0}
        nextOffset={undefined}
        onPage={onPage}
      />,
    )

    const prevBtn = screen.getByRole('button', { name: mockT('libraryPagePrev') })
    const nextBtn = screen.getByRole('button', { name: mockT('libraryPageNext') })
    expect(prevBtn.hasAttribute('disabled')).toBe(true)
    expect(nextBtn.hasAttribute('disabled')).toBe(true)
  })

  it('hides range info when showRange is false and disables buttons when busy', () => {
    const onPage = vi.fn()
    const { container } = render(
      <LibraryPager
        t={t}
        label="Test Pager"
        offset={10}
        limit={10}
        total={50}
        returned={10}
        nextOffset={20}
        busy={true}
        showRange={false}
        onPage={onPage}
      />,
    )

    const pageInfo = container.querySelector('[aria-live="polite"]')
    expect(pageInfo).toBeNull()

    const prevBtn = screen.getByRole('button', { name: mockT('libraryPagePrev') })
    const nextBtn = screen.getByRole('button', { name: mockT('libraryPageNext') })
    expect(prevBtn.hasAttribute('disabled')).toBe(true)
    expect(nextBtn.hasAttribute('disabled')).toBe(true)
  })
})
