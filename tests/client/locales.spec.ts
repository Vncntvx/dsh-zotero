/**
 * Locale bundle discipline: key parity between zh and en, the retired-key
 * absence, non-empty values, no Chinese in the English copy, and none of the
 * stage claims the panel must not make.
 * @module tests/client/locales
 */

import { describe, expect, it } from 'vitest'
import { en, zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'

describe('locale bundles', () => {
  it('carries the same key set in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('drops the retired lens/funnel/toolcard keys', () => {
    const retired: readonly string[] = [
      'lensActivity',
      'lensCitations',
      'lensItems',
      'funnelSearched',
      'funnelRead',
      'funnelCited',
      'badgeRead',
      'badgeCited',
      'starterTidy',
      'starterTidyTemplate',
      'starterCite',
      'starterCiteTemplate',
      'noActivity',
      'activityNote',
      'itemsEmptyNote',
      'itemsSourceNote',
      'itemsSourceOmittedNote',
      'itemsProcessedNote',
      'toolSearchTitle',
      'toolGetTitle',
      'toolRetrieveTitle',
      'toolAttachmentTitle',
      'toolExportTitle',
      'tagSearch',
      'tagGet',
      'tagRetrieve',
      'tagAttachment',
      'tagExport',
      'resultsCount',
      'moreOmitted',
      'scopeLibraryMetadata',
      'scopeLibraryEverything',
      'scopeCollection',
      'scopeSavedSearch',
      'personalNotes',
      'personalAnnotations',
      'evidencePassages',
      'evidenceSources',
      'citationsCount',
      'refsRequested',
      'copyFullText',
      'generateCitation',
      'exportsLabel',
      'quickAccessLabel',
      'noExportsHint',
      'artifactExpandLabel',
      'artifactCollapseLabel',
      'evidenceExpandLabel',
      'evidenceCollapseLabel',
      'truncatedMore',
      'browse',
      'referenceMismatch',
      'statusConnected',
      'filterAttachment',
      'filterFailed',
      'attachmentBadge',
      'reportedEvidenceBadge',
      'openBlockedNote',
      // The 2026-08 UI audit: internal workflow language left the panel —
      // candidates/inspected chips, the snapshot scope note, session facts,
      // and the static-export disclaimer all moved out of the main path.
      'lensEvidence',
      'sourcesScopeNote',
      'sourcesEmptyNote',
      'sidebarSourceCount',
      'countCandidates',
      'countInspected',
      'countEvidence',
      'countExported',
      'overviewFacts',
      'overviewActions',
      'fromSearches',
      'evidenceInDetail',
      'reportedEvidenceInDetail',
      'exportsInDetail',
      'exportsStaticNote',
      'artifactAtLabel',
      'expandFullText',
      'collapseFullText',
      // The copy pass: the cross-source board's defensive scope note left
      // the page — the cards carry their own facts.
      'evidenceScopeNote',
    ]
    for (const key of retired) {
      expect(key in zh, key).toBe(false)
      expect(key in en, key).toBe(false)
    }
  })

  it('keeps every value non-empty and free of Chinese in the English copy', () => {
    for (const key of Object.keys(en) as ZoteroLocaleKey[]) {
      expect(en[key].length, key).toBeGreaterThan(0)
      expect(zh[key].length, key).toBeGreaterThan(0)
      expect(/[\u4e00-\u9fff]/.test(en[key]), key).toBe(false)
    }
  })

  it('never claims stages the calls cannot prove', () => {
    const allZh = Object.values(zh).join(' ')
    expect(allZh).not.toContain('精读')
    expect(allZh).not.toContain('已引用')
    expect(allZh).not.toContain('整理我的库')
    expect(allZh).not.toContain('Personal library')
    expect(allZh).not.toContain('evidence passages')
  })
})
