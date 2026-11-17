// @vitest-environment jsdom
/**
 * The inspector's reading anatomy: the abstract's own five-to-six-line window,
 * the section disclosure it lives inside, and the one text column every block
 * starts on.
 * @module tests/client/library/library-inspector-layout
 */
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS, LIBRARY_SECTIONS } from '../../../src/library-preferences.ts'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryInspector } from '../../../src/client/components/library/LibraryInspector.tsx'
import type { ZoteroItemDetailView } from '../../../src/contract.ts'
import { ITEM_DETAIL } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(() => {
  cleanup()
  restoreLayout()
})

const LONG_ABSTRACT = [
  'Quantum models of cognition describe how people decide under uncertainty.',
  'The framework treats probability judgments as a superposition of evidence.',
  'Interference effects appear when questions are reordered between trials.',
  'The authors compare this account with classical expected-utility theory.',
  'They report four experiments with more than nine hundred participants.',
  'A final section discusses the boundary conditions of the model.',
].join('\n')

/** jsdom has no layout: publish one fixed box for every measured paragraph. */
function stubMeasuredBox(overflows: boolean): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => (overflows ? 400 : 96),
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 96,
  })
}

function restoreLayout(): void {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
}

function mountInspector(detail: ZoteroItemDetailView) {
  return render(
    <LibraryPreferencesContext.Provider
      value={{ preferences: { ...LIBRARY_DEFAULTS, detailExpandedSections: LIBRARY_SECTIONS } }}
    >
      <LibraryInspector
        t={mockT}
        locale={{ getSnapshot: () => ({ active: 'en' }) }}
        inspector={{ phase: 'ready', detail }}
        retry={vi.fn()}
        pageChild={vi.fn()}
        childStates={{}}
        retryChild={vi.fn()}
        inputActions={undefined}
        openFile={undefined}
        resolveAttachment={undefined}
      />
    </LibraryPreferencesContext.Provider>,
  )
}

describe('library inspector prose', () => {
  it('windows a long abstract behind its own disclosure and expands it in place', () => {
    stubMeasuredBox(true)
    mountInspector({ ...ITEM_DETAIL, abstract: LONG_ABSTRACT })
    const showMore = screen.getByRole('button', { name: zh.libraryAbstractShowMore })
    expect(showMore.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText(/Quantum models of cognition/).className).toContain('abstractClamped')
    // The section's own pair is untouched: the block is open, so it offers
    // "收起摘要", while the inner control owns the text window.
    expect(screen.getByRole('button', { name: '收起摘要' })).toBeTruthy()
    act(() => {
      showMore.click()
    })
    const showLess = screen.getByRole('button', { name: zh.libraryAbstractShowLess })
    expect(showLess.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Quantum models of cognition/).className).not.toContain(
      'abstractClamped',
    )
    act(() => {
      showLess.click()
    })
    expect(
      screen
        .getByRole('button', { name: zh.libraryAbstractShowMore })
        .getAttribute('aria-expanded'),
    ).toBe('false')
  })

  it('adds no window to an abstract that fits', () => {
    stubMeasuredBox(false)
    mountInspector({ ...ITEM_DETAIL, abstract: 'Faster attention.' })
    expect(screen.queryByRole('button', { name: zh.libraryAbstractShowMore })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.libraryAbstractShowLess })).toBeNull()
  })

  it('keeps the data-layer truncation note under the prose', () => {
    stubMeasuredBox(false)
    mountInspector({ ...ITEM_DETAIL, abstract: LONG_ABSTRACT, abstractTruncated: true })
    expect(screen.getByText(zh.libraryAbstractTruncated)).toBeTruthy()
  })

  it('gives every block the same header anatomy', () => {
    stubMeasuredBox(false)
    const { container } = mountInspector({
      ...ITEM_DETAIL,
      collections: [{ ref: 'zotero://user/0/collection/COLL0001', name: 'LLM Papers' }],
    })
    // Every block is one section whose header is the section's first element,
    // and that header carries exactly one `.sectionTitle` heading: the static
    // blocks state it directly, the collapsible ones wrap it in the seat Button.
    const sections = [...container.querySelectorAll('section')]
    expect(sections.length).toBeGreaterThanOrEqual(6)
    for (const section of sections) {
      const header = section.firstElementChild
      expect(header).not.toBeNull()
      const titles = section.querySelectorAll('h4')
      expect(titles).toHaveLength(1)
      if (header!.tagName === 'BUTTON') expect(header!.contains(titles[0]!)).toBe(true)
      else expect(header).toBe(titles[0])
    }
  })
})
