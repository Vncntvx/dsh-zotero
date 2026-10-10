/**
 * The workspace view's pure projections, asserted on the functions themselves
 * with no render: the effective-selection rule (`effectiveSelectionOf`), and the
 * overview label helpers (`scopeLabelOf`, `filterLineOf`, `modeLabelOf`). The
 * rendered faces live in `ZoteroWorkspaceView.states` (mount and assert), and
 * `ZoteroWorkspaceView.interaction` (clicks and keys driven to their output).
 * @module tests/client/ZoteroWorkspaceView.helpers
 */

import { describe, expect, it } from 'vitest'
import { effectiveSelectionOf } from '../../src/client/components/workspace/ZoteroWorkspaceView.tsx'
import {
  filterLineOf,
  modeLabelOf,
  scopeLabelOf,
} from '../../src/client/components/workspace/SourceOverview.tsx'
import { zh } from '../../src/client/locales.ts'
import { mixedFixture } from './helpers/source-fixtures.ts'

import { mockT } from './helpers/mock-translate.ts'
const t = mockT

describe('selection', () => {
  it('keeps a selection a filter hides, and falls back only when the workspace lacks it', () => {
    const workspace = mixedFixture()
    const visible = workspace.sources.slice(0, 3)
    // A key inside the union but outside the visible rows is kept: filtering
    // narrows the list, never the document under inspection.
    expect(
      effectiveSelectionOf(
        { key: workspace.sources[5]!.key, focusIndex: 5 },
        workspace.sources,
        visible,
      ),
    ).toBe(workspace.sources[5]!.key)
    // A selection the workspace no longer contains falls back to the first visible.
    expect(
      effectiveSelectionOf(
        { key: 'zotero://user/0/item/ZZZZZZZZ', focusIndex: 0 },
        workspace.sources,
        visible,
      ),
    ).toBe(visible[0]!.key)
    // Nothing visible at all yields no selection.
    expect(
      effectiveSelectionOf({ key: 'zotero://user/0/item/ZZZZZZZZ', focusIndex: 0 }, [], []),
    ).toBeUndefined()
  })
})

describe('overview label helpers', () => {
  it('labels every scope kind, preferring the name then the ref', () => {
    expect(scopeLabelOf({ kind: 'library' }, t)).toBe(zh.overviewScopeLibrary)
    expect(scopeLabelOf({ kind: 'collection', name: 'Reading' }, t)).toBe('Reading')
    expect(scopeLabelOf({ kind: 'collection', ref: 'zotero://user/0/collections/C' }, t)).toBe(
      'zotero://user/0/collections/C',
    )
    expect(scopeLabelOf({ kind: 'collection' }, t)).toBe(zh.overviewScopeCollection)
    expect(scopeLabelOf({ kind: 'savedSearch', name: 'Since 2020' }, t)).toBe('Since 2020')
    expect(scopeLabelOf({ kind: 'savedSearch', ref: 'zotero://user/0/searches/S' }, t)).toBe(
      'zotero://user/0/searches/S',
    )
    expect(scopeLabelOf({ kind: 'savedSearch' }, t)).toBe(zh.overviewScopeSavedSearch)
  })

  it('joins the episode filters and names both search modes', () => {
    expect(filterLineOf(['journalArticle'], ['hot'], t)).toBe('journalArticle · hot')
    expect(filterLineOf([], [], t)).toBe('')
    expect(modeLabelOf('metadata', t)).toBe(zh.modeMetadata)
    expect(modeLabelOf('everything', t)).toBe(zh.modeEverything)
  })
})
