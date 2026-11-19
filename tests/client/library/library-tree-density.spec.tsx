// @vitest-environment jsdom
/**
 * The collection tree's compact density: switching the shared preference
 * applies the compact row scale and resets cached virtual measurements, so the
 * window keeps its place instead of showing blank bands.
 * @module tests/client/library/library-tree-density
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryTree } from '../../../src/client/components/library/LibraryTree.tsx'
import { LibraryPreferencesContext } from '../../../src/client/library-preferences.tsx'
import { LIBRARY_DEFAULTS } from '../../../src/library-preferences.ts'
import { objectIdentity } from '../../../src/client/components/library/navigation-identity.ts'
import {
  collectionRowsOf,
  flattenTree,
} from '../../../src/client/components/library/library-model.ts'
import { ROOT_COLLECTIONS, CHILD_COLLECTIONS } from '../helpers/library-panel-harness.tsx'
import { mockT } from '../helpers/mock-translate.ts'

const rootRef =
  ROOT_COLLECTIONS.items[0]!.kind === 'collection' ? ROOT_COLLECTIONS.items[0]!.ref : ''
const rootPage = {
  rows: collectionRowsOf(ROOT_COLLECTIONS.items),
  total: 3,
  offset: 0,
  limit: 2,
  nextOffset: 2,
}
const treeLane = () => ({
  phase: 'ready' as const,
  rows: collectionRowsOf(CHILD_COLLECTIONS.items),
  total: 2,
  offset: 0,
  limit: 1,
  nextOffset: 1,
})

function treeProps() {
  return {
    t: mockT,
    expanded: new Set([rootRef]),
    identityOf: (ref: string) => objectIdentity(ref),
    loadMoreTree: vi.fn(),
    retryTree: vi.fn(),
    selectScope: vi.fn(),
    toggleCollection: vi.fn(),
    selection: { kind: 'library' as const },
    flatTree: flattenTree(rootPage.rows, () => undefined, new Set([rootRef]), rootPage),
    savedSearches: { phase: 'empty' as const },
    rootLane: { phase: 'ready' as const, ...rootPage, rows: rootPage.rows },
    treeLane,
    loadMoreSavedSearches: vi.fn(),
    retrySavedSearches: vi.fn(),
  }
}

function withDensity(density: 'comfortable' | 'compact') {
  return {
    preferences: { ...LIBRARY_DEFAULTS, listDensity: density },
  }
}

afterEach(cleanup)

describe('collection tree density', () => {
  it('applies the compact scale and keeps rows after a density switch', () => {
    const props = treeProps()
    const { container, rerender } = render(
      <LibraryPreferencesContext.Provider value={withDensity('comfortable')}>
        <LibraryTree {...props} />
      </LibraryPreferencesContext.Provider>,
    )
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0)
    const before = container.querySelector('nav')?.className
    rerender(
      <LibraryPreferencesContext.Provider value={withDensity('compact')}>
        <LibraryTree {...props} />
      </LibraryPreferencesContext.Provider>,
    )
    expect(container.querySelector('nav')?.className).not.toBe(before)
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0)
  })
})
