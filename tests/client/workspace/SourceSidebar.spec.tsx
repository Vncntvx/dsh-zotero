// @vitest-environment jsdom
/**
 * Tests for SourceSidebar: filter bar pills, overflow arrow paging, keyboard
 * listbox navigation, item selection, omitted state notes, and pagination.
 * @module tests/client/workspace/SourceSidebar
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceSidebar } from '../../../src/client/components/workspace/SourceSidebar.tsx'
import type { SourceFilterCounts } from '../../../src/sources/filters.js'
import type { SourcePager } from '../../../src/client/components/workspace/useSourcePage.ts'
import { sourceOf, workspaceOf } from '../helpers/source-fixtures.ts'
import { mockT } from '../helpers/mock-translate.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('../helpers/primitives-stub.ts')
  return primitivesStub()
})

const t = mockT

const DEFAULT_COUNTS: SourceFilterCounts = {
  all: 3,
  pdf: 2,
  retrieved: 2,
  evidence: 2,
  exported: 1,
  issues: 0,
}

function mockPager(overrides: Partial<SourcePager> = {}): SourcePager {
  return {
    pages: [],
    shown: 2,
    loading: false,
    hasMore: true,
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourceSidebar component', () => {
  it('renders filter pills and handles pill selection', () => {
    const setFilter = vi.fn()
    const item1 = sourceOf({ key: 'item-1', title: 'First Item' })
    const ws = workspaceOf([item1], { filterCounts: DEFAULT_COUNTS })

    render(
      <SourceSidebar
        workspace={ws}
        filter="all"
        counts={DEFAULT_COUNTS}
        visible={[item1]}
        selection={{ key: 'item-1', focusIndex: 0 }}
        selectedKey="item-1"
        setFilter={setFilter}
        setSelection={vi.fn()}
        setMobilePane={vi.fn()}
        onOpenEvidence={vi.fn()}
        t={t}
      />,
    )

    const pdfPill = screen.getByText(`${t('filterPdf')} 2`)
    fireEvent.click(pdfPill)
    expect(setFilter).toHaveBeenCalledWith('pdf')
  })

  it('renders left and right overflow arrows and scrolls on click', async () => {
    const item1 = sourceOf({ key: 'item-1', title: 'First Item' })
    const ws = workspaceOf([item1], { filterCounts: DEFAULT_COUNTS })

    render(
      <SourceSidebar
        workspace={ws}
        filter="all"
        counts={DEFAULT_COUNTS}
        visible={[item1]}
        selection={{ key: 'item-1', focusIndex: 0 }}
        selectedKey="item-1"
        setFilter={vi.fn()}
        setSelection={vi.fn()}
        setMobilePane={vi.fn()}
        onOpenEvidence={vi.fn()}
        t={t}
      />,
    )

    const filterBar = screen.getByRole('group', { name: t('filterBarLabel') })
    Object.defineProperty(filterBar, 'scrollLeft', {
      value: 50,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(filterBar, 'scrollWidth', {
      value: 600,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(filterBar, 'clientWidth', {
      value: 200,
      configurable: true,
      writable: true,
    })

    act(() => {
      fireEvent.scroll(filterBar)
    })

    const leftArrow = screen.getByRole('button', { name: t('filterScrollLeft') })
    const rightArrow = screen.getByRole('button', { name: t('filterScrollRight') })
    expect(leftArrow).toBeDefined()
    expect(rightArrow).toBeDefined()

    act(() => {
      fireEvent.click(leftArrow)
    })
    act(() => {
      fireEvent.click(rightArrow)
    })
  })

  it('renders passage board button and invokes onOpenEvidence when clicked', () => {
    const onOpenEvidence = vi.fn()
    const item1 = sourceOf({ key: 'item-1' })
    const ws = workspaceOf([item1], {
      evidencePassageTotal: 7,
      filterCounts: { ...DEFAULT_COUNTS, evidence: 3 },
    })

    render(
      <SourceSidebar
        workspace={ws}
        filter="all"
        counts={{ ...DEFAULT_COUNTS, evidence: 3 }}
        visible={[item1]}
        selection={{ key: 'item-1', focusIndex: 0 }}
        selectedKey="item-1"
        setFilter={vi.fn()}
        setSelection={vi.fn()}
        setMobilePane={vi.fn()}
        onOpenEvidence={onOpenEvidence}
        t={t}
      />,
    )

    const evidenceButton = screen.getByText(t('evidenceEntryLabel', { count: 7 }))
    fireEvent.click(evidenceButton)
    expect(onOpenEvidence).toHaveBeenCalledTimes(1)
  })

  it('renders empty filter state and clears filter on click', () => {
    const setFilter = vi.fn()
    const ws = workspaceOf([], { filterCounts: DEFAULT_COUNTS })

    render(
      <SourceSidebar
        workspace={ws}
        filter="pdf"
        counts={DEFAULT_COUNTS}
        visible={[]}
        selection={{ key: undefined, focusIndex: 0 }}
        selectedKey={undefined}
        setFilter={setFilter}
        setSelection={vi.fn()}
        setMobilePane={vi.fn()}
        onOpenEvidence={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByText(t('filterEmptyNote'))).toBeDefined()
    const clearButton = screen.getByRole('button', { name: t('filterClear') })
    fireEvent.click(clearButton)
    expect(setFilter).toHaveBeenCalledWith('all')
  })

  it('navigates listbox with ArrowDown, ArrowUp, Home, and End keys', () => {
    const setSelection = vi.fn()
    const items = [
      sourceOf({ key: 'item-1', title: 'First Item' }),
      sourceOf({ key: 'item-2', title: 'Second Item' }),
      sourceOf({ key: 'item-3', title: 'Third Item' }),
    ]
    const ws = workspaceOf(items, { filterCounts: DEFAULT_COUNTS })

    render(
      <SourceSidebar
        workspace={ws}
        filter="all"
        counts={DEFAULT_COUNTS}
        visible={items}
        selection={{ key: 'item-1', focusIndex: 0 }}
        selectedKey="item-1"
        setFilter={vi.fn()}
        setSelection={setSelection}
        setMobilePane={vi.fn()}
        onOpenEvidence={vi.fn()}
        t={t}
      />,
    )

    const listbox = screen.getByRole('listbox', { name: t('lensSources') })

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(setSelection).toHaveBeenCalledWith({ key: 'item-2', focusIndex: 1 })

    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(setSelection).toHaveBeenCalledWith({ key: 'item-1', focusIndex: 0 })

    fireEvent.keyDown(listbox, { key: 'End' })
    expect(setSelection).toHaveBeenCalledWith({ key: 'item-3', focusIndex: 2 })

    fireEvent.keyDown(listbox, { key: 'Home' })
    expect(setSelection).toHaveBeenCalledWith({ key: 'item-1', focusIndex: 0 })

    fireEvent.keyDown(listbox, { key: 'Escape' })
  })

  it('selects item on click and updates mobile pane to detail', () => {
    const setSelection = vi.fn()
    const setMobilePane = vi.fn()
    const items = [
      sourceOf({ key: 'item-1', title: 'First Item' }),
      sourceOf({ key: 'item-2', title: 'Second Item' }),
    ]
    const ws = workspaceOf(items, { filterCounts: DEFAULT_COUNTS })

    render(
      <SourceSidebar
        workspace={ws}
        filter="all"
        counts={DEFAULT_COUNTS}
        visible={items}
        selection={{ key: 'item-1', focusIndex: 0 }}
        selectedKey="item-1"
        setFilter={vi.fn()}
        setSelection={setSelection}
        setMobilePane={setMobilePane}
        onOpenEvidence={vi.fn()}
        t={t}
      />,
    )

    const secondRow = screen.getByText('Second Item')
    fireEvent.click(secondRow)
    expect(setSelection).toHaveBeenCalledWith({ key: 'item-2', focusIndex: 1 })
    expect(setMobilePane).toHaveBeenCalledWith('detail')
  })

  it('renders omitted row notes and pager controls when configured', () => {
    const items = [sourceOf({ key: 'item-1' })]
    const ws = workspaceOf(items, {
      omittedRows: 4,
      sourceTotal: 10,
      filterCounts: DEFAULT_COUNTS,
    })
    const pager = mockPager({ shown: 1, hasMore: true })

    render(
      <SourceSidebar
        workspace={ws}
        filter="all"
        counts={DEFAULT_COUNTS}
        visible={items}
        pager={pager}
        selection={{ key: 'item-1', focusIndex: 0 }}
        selectedKey="item-1"
        setFilter={vi.fn()}
        setSelection={vi.fn()}
        setMobilePane={vi.fn()}
        onOpenEvidence={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByText(t('omittedRowsNote', { count: 4 }))).toBeDefined()
    expect(screen.getByText(t('sourcesOmittedNote', { count: 10 }))).toBeDefined()
    expect(screen.getByRole('button', { name: t('sourcePageMore') })).toBeDefined()
  })
})
