/**
 * Opt-in semantic-recall evaluation against one downloaded local model.
 * Skipped unless `SEMANTIC_EVAL=1` and `SEMANTIC_MODEL_DIR` point at a model
 * root, because it runs the real WASM encoder over the committed
 * concept-paraphrase fixtures: this is the measurement the ranking thresholds
 * and the recall targets are checked against, not a unit test.
 *
 *   SEMANTIC_EVAL=1 SEMANTIC_MODEL=lightweight SEMANTIC_MODEL_DIR=/tmp/dsh-models \
 *     npx vitest run tests/integration/semantic-eval.integration.spec.ts
 *
 * Default runs are report-only: they print recall@4 / MRR / control-precision
 * for the selected model. With `SEMANTIC_EVAL_STRICT=1` the committed targets
 * are asserted, so a model that cannot reach them fails loudly instead of
 * shipping behind a number nobody measured.
 * @module tests/integration/semantic-eval
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { semanticModelOf } from '../../src/enrichment-model-catalog.js'
import { openSemanticEmbedder } from '../../src/enrichment/semantic/bundle.js'
import { semanticEvidenceRanker } from '../../src/enrichment/semantic/ranker.js'
import {
  MRR_TARGET,
  RECALL_AT_4_TARGET,
  RECALL_CASES,
  measureRecall,
  type RecallCase,
} from '../helpers/semantic-recall-fixtures.js'

const modelRoot = process.env.SEMANTIC_MODEL_DIR
const modelKey = process.env.SEMANTIC_MODEL ?? 'balanced'
const strict = process.env.SEMANTIC_EVAL_STRICT === '1'
const enabled = process.env.SEMANTIC_EVAL === '1' && typeof modelRoot === 'string'

describe.runIf(enabled)('semantic recall evaluation (opt-in, real model)', () => {
  it(`ranks the committed case set through the hybrid ranker (${modelKey})`, async () => {
    const spec = semanticModelOf(modelKey)
    const embedder = await openSemanticEmbedder(spec, join(modelRoot!, spec.physicalKey))
    try {
      const ranker = semanticEvidenceRanker({ embedder: async () => embedder })
      const rank = async (item: RecallCase) => {
        const result = await ranker.rank({
          query: item.query,
          chunks: item.passages.map((text, index) => ({ text, index })),
        })
        return result.matches.map((entry) => ({ index: entry.index, score: entry.score }))
      }
      const metrics = await measureRecall(RECALL_CASES, rank)
      process.stdout.write(
        `${modelKey}: recall@4=${metrics.recallAt4.toFixed(4)} mrr=${metrics.mrr.toFixed(4)} ` +
          `genericTop2=${metrics.genericTop2} cases=${metrics.cases}\n`,
      )
      if (strict) {
        expect(metrics.recallAt4).toBeGreaterThanOrEqual(RECALL_AT_4_TARGET)
        expect(metrics.mrr).toBeGreaterThanOrEqual(MRR_TARGET)
        expect(metrics.genericTop2).toBe(0)
      } else {
        // A report-only run still proves the pipeline ran end to end.
        expect(metrics.cases).toBe(RECALL_CASES.length)
      }
    } finally {
      await embedder.dispose()
    }
  }, 600_000)
})
