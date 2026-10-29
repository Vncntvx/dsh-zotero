// @vitest-environment jsdom
/**
 * Zotero locate actions tests: title copy and canonical deep link copy.
 * @module tests/client/open/ZoteroLocateActions
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZoteroLocateActions } from '../../../src/client/components/open/ZoteroLocateActions.tsx'

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

describe('ZoteroLocateActions', () => {
  it('renders title copy button when title is present', () => {
    render(<ZoteroLocateActions title="Attention Is All You Need" t={t} />)
    expect(screen.getByRole('button', { name: mockT('copyTitle') })).toBeDefined()
    expect(screen.queryByRole('button', { name: mockT('copyZoteroLink') })).toBeNull()
  })

  it('renders link copy and open in zotero buttons using itemRef', () => {
    render(<ZoteroLocateActions itemRef="zotero://user/0/item/ITEMKEY1" t={t} />)
    expect(screen.getByRole('button', { name: mockT('copyZoteroLink') })).toBeDefined()
    expect(screen.getByRole('button', { name: mockT('openInZotero') })).toBeDefined()
    expect(screen.queryByRole('button', { name: mockT('copyTitle') })).toBeNull()
  })

  it('prefers custom selectUrl when provided', () => {
    render(<ZoteroLocateActions selectUrl="zotero://select/groups/99999/items/GROUPKEY" t={t} />)
    expect(screen.getByRole('button', { name: mockT('copyZoteroLink') })).toBeDefined()
    expect(screen.getByRole('button', { name: mockT('openInZotero') })).toBeDefined()
  })

  it('triggers protocol dispatch when clicking open in zotero button', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ZoteroLocateActions itemRef="zotero://user/0/item/ITEMKEY1" t={t} />)
    const openBtn = screen.getByRole('button', { name: mockT('openInZotero') })
    fireEvent.click(openBtn)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('renders buttons with link variant and custom class', () => {
    render(
      <ZoteroLocateActions
        title="Sample Paper"
        itemRef="zotero://user/0/item/ITEMKEY1"
        variant="link"
        className="custom-locate-btn"
        t={t}
      />,
    )
    const titleBtn = screen.getByRole('button', { name: mockT('copyTitle') })
    const linkBtn = screen.getByRole('button', { name: mockT('copyZoteroLink') })
    const openBtn = screen.getByRole('button', { name: mockT('openInZotero') })
    expect(titleBtn.className).toContain('custom-locate-btn')
    expect(linkBtn.className).toContain('custom-locate-btn')
    expect(openBtn.className).toContain('custom-locate-btn')
  })

  it('renders link variant with default link class when className is omitted', () => {
    render(
      <ZoteroLocateActions
        title="Sample Paper"
        itemRef="zotero://user/0/item/ITEMKEY1"
        variant="link"
        t={t}
      />,
    )
    const titleBtn = screen.getByRole('button', { name: mockT('copyTitle') })
    expect(titleBtn.className).toBeTruthy()
  })

  it('handles invalid item ref gracefully by skipping link buttons', () => {
    render(<ZoteroLocateActions itemRef="invalid-ref" t={t} />)
    expect(screen.queryByRole('button', { name: mockT('copyZoteroLink') })).toBeNull()
    expect(screen.queryByRole('button', { name: mockT('openInZotero') })).toBeNull()
  })

  it('does not fall back to computing selectUrl when selectUrl={null} is explicitly passed', () => {
    render(<ZoteroLocateActions itemRef="zotero://user/0/item/ITEMKEY1" selectUrl={null} t={t} />)
    expect(screen.queryByRole('button', { name: mockT('copyZoteroLink') })).toBeNull()
    expect(screen.queryByRole('button', { name: mockT('openInZotero') })).toBeNull()
  })

  it('renders nothing when neither title nor ref is provided', () => {
    const { container } = render(<ZoteroLocateActions t={t} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
