/**
 * The `scholarly_read query` lane of the concept-paraphrase regression set.
 *
 * The very same cases are driven through the scholarly evidence bridge, which
 * owns its own `chunkText` boundaries. Each passage is padded to a fixed word
 * span count so one chunk maps to exactly one passage; the padded filler is
 * neutral and never appears in a query. Stage 4 swaps the ranker this lane
 * passes in and must assert the same thresholds as the local lane.
 * @module tests/scholarly/read/semantic-recall
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chunkText } from '../../../src/evidence.js'
import { bm25EvidenceRanker } from '../../../src/local/evidence-ranker.js'
import { rankPassages } from '../../../src/scholarly/fulltext/evidence-bridge.js'
import {
  measureRecall,
  MRR_TARGET,
  RECALL_AT_4_TARGET,
  RECALL_CASES,
  scholarlyDocumentOf,
  unitIndexOf,
  type RecallCase,
} from '../../helpers/semantic-recall-fixtures.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const baseline = JSON.parse(
  readFileSync(join(root, 'tests', 'fixtures', 'semantic-recall-baseline.json'), 'utf8'),
) as {
  readonly engine: string
  readonly targets: { readonly recallAt4: number; readonly mrr: number }
  readonly local: Awaited<ReturnType<typeof measureRecall>>
  readonly scholarly: Awaited<ReturnType<typeof measureRecall>>
}

const SCHOLARLY_CHUNK_WORDS = 32

/** Rank one case through the bridge's own chunking and the shipped ranker. */
async function rankScholarly(
  item: RecallCase,
): Promise<readonly { index: number; score: number }[]> {
  const { text, starts } = scholarlyDocumentOf(
    item,
    (passage) => chunkText(passage, 1).length,
    SCHOLARLY_CHUNK_WORDS,
  )
  const { passages: ranked } = await rankPassages({
    ranker: bm25EvidenceRanker,
    text,
    query: item.query,
    limit: item.passages.length,
    maxWords: SCHOLARLY_CHUNK_WORDS,
    maxCharsPerChunk: 1_200,
  })
  return ranked.map((entry) => ({ index: unitIndexOf(entry.start, starts), score: entry.score }))
}

describe('concept-paraphrase regression set (scholarly_read lane)', () => {
  it('maps every ranked span back to a real passage', async () => {
    for (const item of RECALL_CASES) {
      const ranked = await rankScholarly(item)
      expect(ranked.length).toBeLessThanOrEqual(item.passages.length)
      expect(ranked.every((entry) => entry.index >= 0 && entry.index < item.passages.length)).toBe(
        true,
      )
    }
  })

  it('keeps the stage-0 targets frozen against later loosening', () => {
    expect(RECALL_AT_4_TARGET).toBe(0.9)
    expect(MRR_TARGET).toBe(0.75)
    expect(baseline.targets).toEqual({
      recallAt4: RECALL_AT_4_TARGET,
      mrr: MRR_TARGET,
    })
  })

  it('reproduces the committed BM25 baseline exactly', async () => {
    expect(await measureRecall(RECALL_CASES, rankScholarly)).toEqual(baseline.scholarly)
  })

  it('never lets the function-word-only control into the top two', async () => {
    expect((await measureRecall(RECALL_CASES, rankScholarly)).genericTop2).toBe(0)
  })

  it('records the gap a semantic ranker has to close', async () => {
    expect(baseline.scholarly.recallAt4).toBeLessThan(RECALL_AT_4_TARGET)
    expect(baseline.scholarly.mrr).toBeLessThan(MRR_TARGET)
    const experts = RECALL_CASES.filter((item) => item.id === 'en-01' || item.id === 'zh-01')
    for (const item of experts) {
      const ranked = await rankScholarly(item)
      expect(ranked.some((entry) => item.relevant.includes(entry.index))).toBe(false)
    }
  })

  it('keeps lexical and duplicate controls retrievable at baseline', async () => {
    const controls = RECALL_CASES.filter((item) => item.kind !== 'paraphrase')
    const metrics = await measureRecall(controls, rankScholarly)
    expect(metrics.recallAt4).toBe(1)
    expect(metrics.mrr).toBe(1)
  })
})
