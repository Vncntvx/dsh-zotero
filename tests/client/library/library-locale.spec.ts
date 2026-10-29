/**
 * Locale discipline for the library panel's sources: no hardcoded CJK copy in
 * the library components (every string rides `t()` and the dictionaries in
 * `client/locales.ts`), and the English dictionary carries no CJK either —
 * an English UI must never render a Chinese placeholder. The sources are read
 * as raw strings, so the check fails loud the moment a literal sneaks in.
 * @module tests/client/library/library-locale
 */

import { describe, expect, it } from 'vitest'
import { en } from '../../../src/client/locales.ts'
import panelSource from '../../../src/client/components/library/ZoteroLibraryPanel.tsx?raw'
import iconSource from '../../../src/client/components/library/ZoteroLibraryIcon.tsx?raw'
import itemListSource from '../../../src/client/components/library/LibraryItemList.tsx?raw'
import inspectorSource from '../../../src/client/components/library/LibraryInspector.tsx?raw'
import filtersSource from '../../../src/client/components/library/LibraryFilters.tsx?raw'
import tagPickerSource from '../../../src/client/components/library/LibraryTagPicker.tsx?raw'
import treeSource from '../../../src/client/components/library/LibraryTree.tsx?raw'
import writeSource from '../../../src/client/components/library/LibraryWrite.tsx?raw'
import laneControlsSource from '../../../src/client/components/library/LibraryLaneControls.tsx?raw'
import pagerSource from '../../../src/client/components/library/LibraryPager.tsx?raw'
import modelSource from '../../../src/client/components/library/library-model.ts?raw'
import storageSource from '../../../src/client/components/library/library-storage.ts?raw'
import feedSource from '../../../src/client/components/library/useLibraryFeed.ts?raw'
import childFeedSource from '../../../src/client/components/library/useLibraryChildFeed.ts?raw'
import citationActionsSource from '../../../src/client/components/library/LibraryCitationActions.tsx?raw'
import dataPlaneSource from '../../../src/client/components/library/library-data-plane.ts?raw'

const CJK = /[\u4e00-\u9fff]/

const SOURCES: Readonly<Record<string, string>> = {
  'ZoteroLibraryPanel.tsx': panelSource,
  'ZoteroLibraryIcon.tsx': iconSource,
  'LibraryItemList.tsx': itemListSource,
  'LibraryInspector.tsx': inspectorSource,
  'LibraryFilters.tsx': filtersSource,
  'LibraryTagPicker.tsx': tagPickerSource,
  'LibraryTree.tsx': treeSource,
  'LibraryWrite.tsx': writeSource,
  'LibraryLaneControls.tsx': laneControlsSource,
  'LibraryPager.tsx': pagerSource,
  'library-model.ts': modelSource,
  'library-storage.ts': storageSource,
  'useLibraryFeed.ts': feedSource,
  'useLibraryChildFeed.ts': childFeedSource,
  'LibraryCitationActions.tsx': citationActionsSource,
  'library-data-plane.ts': dataPlaneSource,
}

describe('library panel locale discipline', () => {
  it('keeps hardcoded CJK out of the library component sources', () => {
    for (const [name, content] of Object.entries(SOURCES)) {
      const line = content.split('\n').findIndex((line) => CJK.test(line))
      expect(line, `${name} carries CJK at line ${line + 1}; route the copy through t()`).toBe(-1)
    }
  })

  it('keeps CJK out of the English dictionary', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(CJK.test(value), `en.${key} carries CJK: ${value}`).toBe(false)
    }
  })
})
