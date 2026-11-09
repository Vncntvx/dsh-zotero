// @vitest-environment jsdom
/**
 * The SourcePageControls component: the "show more" button, the loading note,
 * the error alert with its retry button, and the null render when the list is
 * complete and unfailed.
 * @module tests/client/workspace/SourcePageControls
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcePageControls } from '../../../src/client/components/workspace/SourcePageControls.tsx'
import type { SourcePager } from '../../../src/client/components/workspace/useSourcePage.ts'

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

function stubPager(overrides: Partial<SourcePager> = {}): SourcePager {
  return {
    pages: [],
    shown: 0,
    loading: false,
    error: undefined,
    hasMore: true,
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

describe('SourcePageControls component', () => {
  it('renders nothing when the list has no more rows and no error', () => {
    const pager = stubPager({ hasMore: false, error: undefined })
    const { container } = render(<SourcePageControls pager={pager} label="Sources" t={t} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the load-more button and invokes loadMore on click', () => {
    const pager = stubPager({ hasMore: true })
    render(<SourcePageControls pager={pager} label="Sources" t={t} />)
    const button = screen.getByRole('button', { name: t('sourcePageMore') })
    expect(button).toBeDefined()
    fireEvent.click(button)
    expect(pager.loadMore).toHaveBeenCalledTimes(1)
  })

  it('disables the load-more button and announces loading when a page is in flight', () => {
    const pager = stubPager({ hasMore: true, loading: true })
    render(<SourcePageControls pager={pager} label="Sources" t={t} />)
    const button = screen.getByRole('button', { name: t('sourcePageMore') })
    expect(button.getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe(t('libraryLoading'))
  })

  it('renders the error alert and invokes retry on button click', () => {
    const pager = stubPager({ hasMore: false, error: 'Failed to page literature trail' })
    render(<SourcePageControls pager={pager} label="Sources" t={t} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Failed to page literature trail')
    const retryBtn = screen.getByRole('button', { name: t('sourcePageRetry') })
    fireEvent.click(retryBtn)
    expect(pager.retry).toHaveBeenCalledTimes(1)
  })

  it('labels the container with the accessible group name', () => {
    const pager = stubPager({ hasMore: true })
    render(<SourcePageControls pager={pager} label="Literature trail sources" t={t} />)
    const group = screen.getByRole('group', { name: 'Literature trail sources' })
    expect(group).toBeDefined()
  })
})
