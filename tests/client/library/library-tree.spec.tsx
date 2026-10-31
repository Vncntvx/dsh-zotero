// @vitest-environment jsdom
/** Collection keyboard navigation and independently recoverable navigation pages. */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryTree } from '../../../src/client/components/library/LibraryTree.tsx'
import { objectIdentity } from '../../../src/client/components/library/navigation-identity.ts'
import {
  collectionRowsOf,
  flattenTree,
  type LibraryLaneState,
  type CollectionRowView,
} from '../../../src/client/components/library/library-model.ts'
import {
  ROOT_COLLECTIONS,
  CHILD_COLLECTIONS,
  SAVED_SEARCHES,
} from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'
import { zh } from '../../../src/client/locales.ts'

afterEach(cleanup)
const rootRef =
  ROOT_COLLECTIONS.items[0]!.kind === 'collection' ? ROOT_COLLECTIONS.items[0]!.ref : ''
const rootPage = {
  rows: collectionRowsOf(ROOT_COLLECTIONS.items),
  total: 3,
  offset: 0,
  limit: 2,
  nextOffset: 2,
}
const childPage = {
  rows: collectionRowsOf(CHILD_COLLECTIONS.items),
  total: 2,
  offset: 0,
  limit: 1,
  nextOffset: 1,
}
const loadedCount = (loaded: number, total: number) =>
  zh.libraryLoadedCount.replace('{loaded}', `${loaded}`).replace('{total}', `${total}`)

function mountTree(
  expanded = new Set([rootRef]),
  lane: LibraryLaneState<CollectionRowView> = { phase: 'ready', ...childPage },
  roots: readonly CollectionRowView[] = rootPage.rows,
  laneOf?: (ref?: string) => LibraryLaneState<CollectionRowView> | undefined,
) {
  const treeLane = laneOf ?? (() => lane)
  const servedLane = (ref?: string) => {
    const state = treeLane(ref)
    return state?.phase === 'ready' ? state : undefined
  }
  const loadMoreTree = vi.fn(),
    retryTree = vi.fn(),
    selectScope = vi.fn(),
    toggleCollection = vi.fn()
  const props = {
    t: mockT,
    expanded,
    identityOf: (ref: string) => objectIdentity(ref),
    loadMoreTree,
    retryTree,
    selectScope,
    toggleCollection,
    selection: { kind: 'library' as const },
    flatTree: flattenTree(roots, servedLane, expanded, rootPage),
    savedSearches: {
      phase: 'ready' as const,
      rows: SAVED_SEARCHES.items
        .filter((row) => row.kind === 'savedSearch')
        .map((row) => ({
          ...row,
          conditions: [{ condition: 'title', operator: 'contains', value: 'term' }],
        })),
      total: 1,
      offset: 0,
      limit: 1,
      nextOffset: undefined,
    },
    rootLane: { phase: 'ready' as const, ...rootPage, rows: roots },
    treeLane,
    loadMoreSavedSearches: vi.fn(),
    retrySavedSearches: vi.fn(),
  }
  const view = render(<LibraryTree {...props} />)
  return { ...view, props }
}

describe('collection tree navigation', () => {
  it('moves the tab stop to the remaining root when a focused child is removed', () => {
    const { props, rerender } = mountTree()
    const rows = screen.getAllByRole('treeitem')
    act(() => rows[1]!.focus())
    rerender(
      <LibraryTree
        {...props}
        expanded={new Set()}
        flatTree={flattenTree(rootPage.rows, () => undefined, new Set(), rootPage)}
      />,
    )
    expect(screen.getAllByRole('treeitem')[0]!.getAttribute('tabindex')).toBe('0')
    const last = screen.getAllByRole('treeitem').at(-1)!
    fireEvent.keyDown(last, { key: 'ArrowLeft' })
    expect(props.toggleCollection).not.toHaveBeenCalled()
  })
  it('retries a failed root listing without selecting a collection', () => {
    const { props, rerender } = mountTree()
    rerender(
      <LibraryTree
        {...props}
        rootLane={{
          phase: 'error',
          message: 'roots unavailable',
          previous: { phase: 'ready', ...rootPage },
        }}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: `${zh.libraryCollections}: ${zh.libraryRetry}` }),
    )
    expect(props.retryTree).toHaveBeenCalledWith(undefined)
    expect(props.selectScope).not.toHaveBeenCalled()
  })
  it('walks rows with arrows and Home/End, selects with Enter and returns to a collapsed parent', () => {
    const { props } = mountTree()
    const rows = screen.getAllByRole('treeitem')
    act(() => rows[0]!.focus())
    fireEvent.keyDown(rows[0]!, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1]!, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
    fireEvent.keyDown(rows[1]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'End' })
    expect(document.activeElement).toBe(rows.at(-1))
    fireEvent.keyDown(rows.at(-1)!, { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0]!, { key: 'ArrowLeft' })
    expect(props.toggleCollection).toHaveBeenCalledWith(rootRef)
    fireEvent.keyDown(rows[1]!, { key: 'Enter' })
    expect(props.selectScope).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'collection',
        name:
          CHILD_COLLECTIONS.items[0]!.kind === 'collection' ? CHILD_COLLECTIONS.items[0]!.name : '',
      }),
    )
    fireEvent.keyDown(rows[0]!, { key: 'Tab' })
    expect(props.selectScope).toHaveBeenCalledTimes(1)
  })

  it('expands a collapsed row and transfers focus from an expander into the tree', () => {
    const { props } = mountTree(new Set())
    const rows = screen.getAllByRole('treeitem')
    fireEvent.keyDown(rows[0]!, { key: 'ArrowRight' })
    expect(props.toggleCollection).toHaveBeenCalledWith(rootRef)
    const expander = screen.getByRole('button', { name: rootPage.rows[0]!.name })
    fireEvent.keyDown(expander, { key: 'End' })
    expect(document.activeElement).toBe(rows.at(-1))
    fireEvent.keyDown(expander, { key: 'Home' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(expander, { key: 'Tab' })
    fireEvent.keyDown(rows[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(rows[0])
  })

  it('pages a root and child lane separately and retries the failed child in place', () => {
    const { props } = mountTree(new Set([rootRef]), {
      phase: 'error',
      message: 'child failed',
      previous: { phase: 'ready', ...childPage },
    })
    const rootGroup = screen.getAllByRole('group', { name: zh.libraryCollections })[0]!
    const childGroup = screen.getAllByRole('group', { name: rootPage.rows[0]!.name })[0]!
    fireEvent.click(within(rootGroup).getByRole('button', { name: zh.libraryLoadMore }))
    expect(props.loadMoreTree).toHaveBeenCalledWith(undefined)
    expect(within(childGroup).queryByRole('button', { name: zh.libraryLoadMore })).toBeNull()
    fireEvent.click(
      within(childGroup).getByRole('button', {
        name: `${rootPage.rows[0]!.name}: ${zh.libraryRetry}`,
      }),
    )
    expect(props.retryTree).toHaveBeenCalledWith(rootRef)
    expect(screen.getByText('title · contains · term')).toBeTruthy()
  })

  it('shows the shared loading note while a lane pages further', () => {
    mountTree(new Set([rootRef]), {
      phase: 'loading',
      previous: { phase: 'ready', ...childPage },
    })
    const childGroup = screen.getAllByRole('group', { name: rootPage.rows[0]!.name })[0]!
    expect(within(childGroup).getByRole('status').textContent).toBe(zh.libraryLoading)
  })

  it('shows the loaded count beside load more and drops it once the lane is complete', () => {
    const { props, rerender } = mountTree()
    const childGroup = () => screen.getAllByRole('group', { name: rootPage.rows[0]!.name })[0]!
    expect(within(childGroup()).getByText(loadedCount(1, 2))).toBeTruthy()
    rerender(
      <LibraryTree
        {...props}
        treeLane={() => ({ phase: 'ready', ...childPage, total: 1, nextOffset: undefined })}
      />,
    )
    expect(within(childGroup()).queryByText(loadedCount(1, 1))).toBeNull()
  })

  it('hides the expander for a collection Zotero counts as childless', () => {
    const roots: CollectionRowView[] = [
      {
        kind: 'collection',
        ref: 'zotero://user/0/collection/COLL0098',
        name: 'Childless',
        path: ['Childless'],
        depth: 0,
        childCount: 0,
      },
      {
        kind: 'collection',
        ref: 'zotero://user/0/collection/COLL0099',
        name: 'Nested',
        path: ['Nested'],
        depth: 0,
        childCount: 2,
      },
    ]
    // No child page served yet: the count alone decides the expander.
    mountTree(new Set(), { phase: 'loading' }, roots)
    expect(screen.queryByRole('button', { name: 'Childless' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Nested' })).toBeTruthy()
  })
  it('renders nested closing branches innermost first and pages the lane they close', () => {
    const root: CollectionRowView = {
      kind: 'collection',
      ref: 'zotero://user/0/collection/COLL0100',
      name: 'Root',
      path: ['Root'],
      depth: 0,
    }
    const child: CollectionRowView = {
      ...root,
      ref: 'zotero://user/0/collection/COLL0101',
      name: 'Child',
      path: ['Root', 'Child'],
      depth: 1,
    }
    const grand: CollectionRowView = {
      ...root,
      ref: 'zotero://user/0/collection/COLL0102',
      name: 'Grandchild',
      path: ['Root', 'Child', 'Grandchild'],
      depth: 2,
    }
    const lanes = new Map<string, LibraryLaneState<CollectionRowView>>([
      [
        root.ref,
        { phase: 'ready', rows: [child], total: 1, offset: 0, limit: 1, nextOffset: undefined },
      ],
      [child.ref, { phase: 'ready', rows: [grand], total: 2, offset: 0, limit: 1, nextOffset: 1 }],
    ])
    const { props } = mountTree(
      new Set([root.ref, child.ref]),
      { phase: 'ready', ...childPage },
      [root],
      (ref) => (ref === undefined ? undefined : lanes.get(ref)),
    )
    const row = screen.getByRole('treeitem', { name: 'Grandchild' })
    const groups = within(row.closest('li')!).getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Child', 'Root'])
    const childGroup = groups.find((group) => group.getAttribute('aria-label') === 'Child')!
    fireEvent.click(within(childGroup).getByRole('button', { name: zh.libraryLoadMore }))
    expect(props.loadMoreTree).toHaveBeenCalledWith(child.ref)
  })
})

it('removes confirmed leaf expanders and keeps the row keyboard focus', () => {
  mountTree(new Set(), {
    phase: 'ready',
    rows: [],
    total: 0,
    offset: 0,
    limit: 50,
    nextOffset: undefined,
  })
  const row = screen.getAllByRole('treeitem')[0]!
  act(() => row.focus())
  expect(row.hasAttribute('aria-expanded')).toBe(false)
  expect(screen.queryByRole('button', { name: rootPage.rows[0]!.name })).toBeNull()
  fireEvent.keyDown(row, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(row)
})

it('locates and focuses the selected row without changing selection', () => {
  const { props, rerender } = mountTree()
  rerender(<LibraryTree {...props} locatedRef={rootRef} />)
  expect(document.activeElement?.getAttribute('role')).toBe('treeitem')
  expect(props.selectScope).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: rootPage.rows[0]!.name }))
  expect(props.toggleCollection).toHaveBeenCalledWith(rootRef)
})

it('appends children from the control after the visible branch', () => {
  const { props } = mountTree()
  const group = screen.getByRole('group', { name: rootPage.rows[0]!.name })
  fireEvent.click(within(group).getByRole('button', { name: zh.libraryLoadMore }))
  expect(props.loadMoreTree).toHaveBeenCalledWith(rootRef)
  const child = screen.getAllByRole('treeitem')[1]!
  fireEvent.keyDown(child, { key: 'ArrowRight' })
  fireEvent.keyDown(child, { key: 'ArrowRight' })
})

it('keeps focus on an expanded row with no visible child when pressing right', () => {
  const childRef = childPage.rows[0]!.ref
  const { props } = mountTree(new Set([rootRef, childRef]))
  const child = screen.getAllByRole('treeitem')[1]!
  act(() => child.focus())
  fireEvent.keyDown(child, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(child)
  expect(props.toggleCollection).not.toHaveBeenCalled()
})

it('selects a row whose server qualifier only the row carries', () => {
  const qualified: CollectionRowView = {
    kind: 'collection',
    ref: 'zotero://user/0/collection/COLL0200?server=S1',
    name: 'Qualified',
    path: ['Qualified'],
    depth: 0,
  }
  const { props, rerender } = mountTree(new Set(), { phase: 'loading' }, [qualified])
  rerender(
    <LibraryTree
      {...props}
      identityOf={(ref: string) => objectIdentity(ref, 'S1')}
      selection={{
        kind: 'collection',
        ref: 'zotero://user/0/collection/COLL0200',
        name: 'Qualified',
      }}
    />,
  )
  expect(screen.getByRole('treeitem', { name: 'Qualified' }).getAttribute('aria-selected')).toBe(
    'true',
  )
})

it('renders a row whose ref is not a URL', () => {
  const opaque: CollectionRowView = {
    kind: 'collection',
    ref: 'not-a-url',
    name: 'Opaque',
    path: ['Opaque'],
    depth: 0,
  }
  const { props, rerender } = mountTree(new Set(), { phase: 'loading' }, [opaque])
  rerender(
    <LibraryTree
      {...props}
      selection={{ kind: 'collection', ref: 'zotero://user/0/collection/COLL0999', name: 'Other' }}
    />,
  )
  expect(screen.getByRole('treeitem', { name: 'Opaque' }).getAttribute('aria-selected')).toBe(
    'false',
  )
})
