/**
 * The fixture gallery's shape contract: every fixture builds a workspace
 * whose sources are stable, renderable, and exercise the state it names.
 * This is the floor the visual baseline renders from.
 * @module tests/client/source-fixtures
 */

import { describe, expect, it } from 'vitest'
import { filterCountsOf } from '../../src/client/sources/selectors.ts'
import { hasPdf } from '../../src/client/sources/source-capabilities.ts'
import {
  largeArtifactFixture,
  largeFixture,
  mismatchFixture,
  mixedFixture,
  offlineFixture,
  repeatedRetrieveFixture,
  singleFixture,
  zeroMatchFixture,
} from './helpers/source-fixtures.ts'

describe('source fixtures', () => {
  it('single: one item with a PDF, evidence, and an export', () => {
    const workspace = singleFixture()
    expect(workspace.sources).toHaveLength(1)
    const item = workspace.sources[0]!
    expect(hasPdf(item)).toBe(true)
    expect(item.facts.evidenceCount).toBe(2)
    expect(item.facts.exportCount).toBe(1)
    expect(workspace.exports).toHaveLength(1)
  })

  it('mixed: twelve items spanning every badge and filter', () => {
    const workspace = mixedFixture()
    expect(workspace.sources).toHaveLength(12)
    const counts = filterCountsOf(workspace.sources)
    expect(counts.pdf).toBeGreaterThan(0)
    expect(counts.evidence).toBeGreaterThan(0)
    expect(counts.exported).toBeGreaterThan(0)
    expect(counts.issues).toBeGreaterThan(0)
    expect(workspace.sources.some((item) => item.provenance === 'mismatch')).toBe(true)
    expect(workspace.sources.some((item) => item.operations.running > 0)).toBe(true)
  })

  it('large: thirty items in stable order', () => {
    const workspace = largeFixture()
    expect(workspace.sources).toHaveLength(30)
    expect(workspace.sources[0]!.firstSeenAt).toBeLessThan(workspace.sources[29]!.firstSeenAt)
  })

  it('zero match: the item exists but no source returned passages', () => {
    const workspace = zeroMatchFixture()
    expect(workspace.sources).toHaveLength(1)
    const item = workspace.sources[0]!
    expect(item.facts.evidenceCount).toBe(0)
    expect(item.retrievalFacts?.sourceAvailability.PDF?.unavailable).toBe(true)
  })

  it('mismatch: the open action is blocked but the item still has a PDF', () => {
    const workspace = mismatchFixture()
    const item = workspace.sources[0]!
    expect(item.provenance).toBe('mismatch')
    expect(hasPdf(item)).toBe(true)
  })

  it('repeated retrieve: three runs with truncation and surviving evidence', () => {
    const workspace = repeatedRetrieveFixture()
    const item = workspace.sources[0]!
    expect(item.retrievalSummary?.runCount).toBe(3)
    expect(item.retrievalSummary?.truncated).toBe(true)
    expect(item.facts.evidenceCount).toBe(3)
    expect(item.searches).toHaveLength(3)
  })

  it('large artifact: the export text is big enough to exercise expand', () => {
    const workspace = largeArtifactFixture()
    expect(workspace.exports).toHaveLength(1)
    expect(workspace.exports[0]!.text.length).toBeGreaterThan(2000)
    expect(workspace.exports[0]!.refsOmitted).toBe(19)
  })

  it('offline: the same data as single, ready for a disconnected connection view', () => {
    const workspace = offlineFixture()
    expect(workspace.sources).toHaveLength(1)
    expect(hasPdf(workspace.sources[0]!)).toBe(true)
  })
})
