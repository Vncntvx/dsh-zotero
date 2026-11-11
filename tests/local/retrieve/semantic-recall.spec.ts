/**
 * The `zotero_retrieve` lane of the concept-paraphrase regression set.
 *
 * Stage 0 fixes the corpus, the metrics, the thresholds, and a committed
 * baseline of the term-overlap ranker. Stage 4 swaps the ranker this lane
 * passes in and must assert the same thresholds; nothing here may be skipped in
 * the meantime, and every assertion below is active from the day it lands.
 *
 * The lane ranks through `bm25EvidenceRanker` rather than `rankChunks`
 * directly, because that is what `zotero_retrieve` now does: the baseline is a
 * statement about the shipped path, not about a primitive one layer below it.
 * The two agree exactly — the fused value is a strictly monotone function of
 * the BM25 position, and both break ties by chunk index — so the committed
 * numbers do not move.
 * @module tests/local/retrieve/semantic-recall
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rankChunks } from '../../../src/evidence.js'
import { bm25EvidenceRanker } from '../../../src/local/evidence-ranker.js'
import {
  measureRecall,
  MRR_TARGET,
  RECALL_AT_4_TARGET,
  RECALL_CASES,
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

/** Rank one case through the strategy `zotero_retrieve` uses. */
async function rankLocal(item: RecallCase): Promise<readonly { index: number; score: number }[]> {
  const result = await bm25EvidenceRanker.rank({
    query: item.query,
    chunks: item.passages.map((text, index) => ({ text, index })),
  })
  return result.matches.map((entry) => ({ index: entry.index, score: entry.score }))
}

describe('concept-paraphrase regression set (zotero_retrieve lane)', () => {
  it('is a fixed, balanced, well-formed case set', () => {
    expect(RECALL_CASES).toHaveLength(24)
    expect(RECALL_CASES.filter((item) => item.language === 'en')).toHaveLength(12)
    expect(new Set(RECALL_CASES.map((item) => item.id)).size).toBe(24)
    expect(RECALL_CASES.filter((item) => item.kind === 'paraphrase')).toHaveLength(20)
    for (const item of RECALL_CASES) {
      expect(item.passages).toHaveLength(8)
      expect(item.relevant.every((index) => index >= 0 && index < item.passages.length)).toBe(true)
      expect(item.relevant).not.toContain(item.generic)
    }
  })

  it('keeps the stage-0 targets frozen against later loosening', () => {
    expect(RECALL_AT_4_TARGET).toBe(0.9)
    expect(MRR_TARGET).toBe(0.75)
    expect(baseline.targets).toEqual({
      recallAt4: RECALL_AT_4_TARGET,
      mrr: MRR_TARGET,
    })
    expect(baseline.engine).toBe('bm25-post-query-normalization')
  })

  it('reproduces the committed BM25 baseline exactly', async () => {
    expect(await measureRecall(RECALL_CASES, rankLocal)).toEqual(baseline.local)
  })

  it('never lets the function-word-only control into the top two', async () => {
    expect((await measureRecall(RECALL_CASES, rankLocal)).genericTop2).toBe(0)
  })

  it('records the gap a semantic ranker has to close', async () => {
    expect(baseline.local.recallAt4).toBeLessThan(RECALL_AT_4_TARGET)
    expect(baseline.local.mrr).toBeLessThan(MRR_TARGET)
    const experts = RECALL_CASES.filter((item) => item.id === 'en-01' || item.id === 'zh-01')
    expect(experts).toHaveLength(2)
    for (const item of experts) {
      const ranked = await rankLocal(item)
      expect(ranked.some((entry) => item.relevant.includes(entry.index))).toBe(false)
    }
  })

  it('keeps lexical and duplicate controls retrievable at baseline', async () => {
    const controls = RECALL_CASES.filter((item) => item.kind !== 'paraphrase')
    const metrics = await measureRecall(controls, rankLocal)
    expect(metrics.recallAt4).toBe(1)
    expect(metrics.mrr).toBe(1)
  })

  it('orders the seam exactly as the raw BM25 primitive does', async () => {
    // The baseline was measured on `rankChunks`; this pins the equivalence the
    // lane now relies on, so a future change to the fusion cannot quietly move
    // the committed numbers while the numbers still "pass".
    for (const item of RECALL_CASES) {
      const raw = rankChunks(
        item.query,
        item.passages.map((text, index) => ({ text, index })),
      )
        .filter((entry) => entry.score > 0)
        .map((entry) => entry.index)
      const seam = (await rankLocal(item)).map((entry) => entry.index)
      expect(seam).toEqual(raw)
    }
  })
})
