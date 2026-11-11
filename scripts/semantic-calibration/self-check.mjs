// Pure CPU/filesystem self-checks, never encoder/model acceptance.
// node scripts/semantic-calibration/self-check.mjs
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { SEMANTIC_MODELS } from '../semantic-model-catalog.mjs'
import {
  backgroundEntries,
  canonical,
  cli,
  digestOf,
  loadDataset,
  print,
  splitEntries,
  validateDataset,
} from './dataset.mjs'
import { cosine, featureRows, loadEmbeddings, modelIdentity } from './features.mjs'
import { fitCandidate } from './fit.mjs'
import { fitLogistic, groupedSelect, predict } from './logistic.mjs'
import { admissionSummary, selectThreshold } from './metrics.mjs'
import { corpusRequests } from './prepare.mjs'
import {
  binomialBounds,
  clusterBootstrap,
  minimumZeroFailureTrials,
  randomOf,
} from './statistics.mjs'
import { validateFrozenCandidate } from './evaluate.mjs'

const near = (actual, expected, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
const checks = []
const check = async (name, fn) => {
  await fn()
  checks.push(name)
}
const scriptPath = (name) => fileURLToPath(new URL(name, import.meta.url))

cli(async () => {
  const dataset = await loadDataset()
  await check('provenance, partition IDs, unique texts, and legacy exclusion validate', () => {
    const counts = validateDataset(dataset)
    for (const split of ['train', 'calibration', 'heldout']) {
      assert.equal(counts[split].perLanguage.en.negativeIntents, 36)
      assert.equal(counts[split].perLanguage.zh.negativeIntents, 36)
    }
    const legacy = structuredClone(dataset)
    legacy.partitions.train.families[0].queries[0].text.en = legacy.quarantine.legacyCases[0].query
    assert.throws(() => validateDataset(legacy), /quarantined/)
    const duplicate = structuredClone(dataset)
    duplicate.partitions.heldout.families[0].documents[0].text.en =
      duplicate.partitions.train.families[0].documents[0].text.en
    assert.throws(() => validateDataset(duplicate), /duplicate text/)
    const family = structuredClone(dataset)
    family.partitions.calibration.families[0].documentFamily =
      family.partitions.train.families[0].documentFamily
    assert.throws(() => validateDataset(family), /document family/)
  })
  await check(
    'exact binomial endpoints, nonzero-error identities and minimum sample support',
    () => {
      near(binomialBounds(0, 300).upper, -Math.expm1(Math.log(0.05) / 300))
      near(binomialBounds(300, 300).lower, Math.exp(Math.log(0.05) / 300))
      near(binomialBounds(1, 2).lower, 1 - Math.sqrt(0.95))
      near(binomialBounds(1, 2).upper, Math.sqrt(0.95))
      near(binomialBounds(1, 1).lower, 0.05)
      assert.equal(binomialBounds(0, 0).upper, 1)
      assert.equal(minimumZeroFailureTrials(), 299)
      assert.ok(binomialBounds(1, 300).upper > 0.01)
      assert.ok(binomialBounds(0, 36).upper > 0.079)
      assert.throws(() => binomialBounds(4, 3), /counts/)
      const clusters = [
        { numerator: 1, denominator: 2 },
        { numerator: 0, denominator: 3 },
        { numerator: 2, denominator: 2 },
      ]
      assert.deepEqual(clusterBootstrap(clusters), clusterBootstrap(clusters))
    },
  )
  await check(
    'ridge solution agrees with independent symmetric scalar optimum and is repeatable',
    () => {
      const rows = [-1, 1].map((x, i) => ({
        familyId: `f${i}`,
        documentFamilyId: `f${i}`,
        language: 'en',
        intentId: `i${i}`,
        label: i,
        features: [x, 0, 0, 0, 0],
      }))
      const model = fitLogistic(rows, 0.1)
      let lo = 0
      let hi = 10
      for (let i = 0; i < 100; i++) {
        const beta = (lo + hi) / 2
        if (0.1 * beta > 1 / (1 + Math.exp(beta))) hi = beta
        else lo = beta
      }
      near(model.coefficients[0], 0)
      near(model.coefficients[1], (lo + hi) / 2, 1e-7)
      assert.equal(canonical(model), canonical(fitLogistic(rows, 0.1)))
      const repeated = [...rows, ...Array.from({ length: 20 }, () => rows[0])]
      near(fitLogistic(repeated, 0.1).coefficients[1], model.coefficients[1], 1e-7)
      assert.ok(predict(rows[1].features, model) > predict(rows[0].features, model))
      assert.throws(
        () =>
          fitLogistic(
            rows.map((row) => ({ ...row, label: 1 })),
            0.1,
          ),
        /both labels/,
      )
      const extreme = rows.map((row) => ({
        ...row,
        features: [row.features[0] * 1e100, 0, 0, 0, 0],
      }))
      assert.ok(fitLogistic(extreme, 0.1).coefficients.every(Number.isFinite))
    },
  )
  await check('five features use fixed opposite-side banks and Unicode codepoint lengths', () => {
    const mini = {
      background: {
        families: [{ id: 'b', query: { en: 'q1', zh: 'q2' }, document: { en: 'd1', zh: 'd2' } }],
      },
    }
    const bank = backgroundEntries(mini)
    const vectors = new Map(
      bank.map((entry) => [entry.key, entry.side === 'query' ? [0, 1] : [1, 0]]),
    )
    vectors.set('q', [1, 0])
    vectors.set('d', [0, 1])
    const result = featureRows(
      mini,
      [{ queryKey: 'q', documentKey: 'd', queryText: '😀a', documentText: '甲乙丙' }],
      { vectors },
      1,
    )[0]
    assert.deepEqual(result.features.slice(0, 3), [0, -1, -1])
    near(result.features[3], Math.log1p(2))
    near(result.features[4], Math.log1p(3))
    assert.throws(() => cosine([1], [1, 0]), /dimension/)
    assert.throws(() => cosine([0], [1]), /Zero/)
    assert.throws(() => cosine([NaN], [1]), /Nonfinite/)
  })
  await check('query and document families are jointly held out during grouped selection', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      [0, 1].map((label) => ({
        familyId: `f${i}`,
        documentFamilyId: `f${i}`,
        language: 'en',
        intentId: `i${i}-${label}`,
        label,
        features: [label, i, 0, 0, 0],
      })),
    ).flat()
    const result = groupedSelect(new Map([[1, rows]]), {
      kCandidates: [1],
      ridgeCandidates: [0.1],
      folds: 3,
    })
    assert.equal(Object.keys(result.foldByFamily).length, 6)
    assert.ok(result.selected.foldLosses.every(Number.isFinite))
    assert.deepEqual(
      result,
      groupedSelect(new Map([[1, rows]]), { kCandidates: [1], ridgeCandidates: [0.1], folds: 3 }),
    )
  })
  await check(
    'variants and repeated pairs cannot inflate negative-query counts or precision',
    () => {
      const base = {
        familyId: 'f',
        intentId: 'negative',
        language: 'en',
        negativeIntent: true,
        documentKey: 'd',
        label: 0,
        confidence: 0.8,
      }
      const protocol = { ...dataset.manifest.protocol, languages: ['en'], bootstrapReplicates: 100 }
      const result = admissionSummary(
        Array.from({ length: 50 }, (_, phrasing) => ({ ...base, phrasing })),
        0.5,
        protocol,
      )
      assert.equal(result.perLanguage.en.negativeAnyHit.trials, 1)
      assert.equal(result.perLanguage.en.negativeAnyHit.successes, 1)
      assert.equal(result.perLanguage.en.mixedReturnedPrecision.trials, 1)
      const empty = admissionSummary([{ ...base, confidence: 0 }], 0.99, protocol)
      assert.equal(empty.perLanguage.en.mixedReturnedPrecision.lower, 0)
      assert.equal(selectThreshold([{ ...base, confidence: 0 }], protocol).selected, null)
    },
  )
  await check(
    'stress corpus sizes preserve unique intent units and sparse duplicate source handles',
    () => {
      // Do not prepare or score heldout in this self-check.
      const requests = corpusRequests(dataset, 'train', 128)
      assert.ok(requests.some((row) => row.size === 1))
      assert.ok(requests.some((row) => row.size === 128 && row.phrasingCount === 5))
      for (const row of requests) {
        assert.equal(new Set(row.chunks.map((chunk) => chunk.index)).size, row.size)
        if (row.mode === 'negative-only') assert.ok(row.chunks.every((chunk) => !chunk.relevant))
        if (row.size > 36) assert.ok(row.uniqueDocumentTexts <= 36)
      }
    },
  )
  await check('CLI fails explicitly on absent vectors and insufficient acceptance support', () => {
    const fit = spawnSync(process.execPath, [scriptPath('fit.mjs')], { encoding: 'utf8' })
    assert.equal(fit.status, 1)
    assert.match(fit.stderr, /Missing --embeddings/)
    const ready = spawnSync(process.execPath, [scriptPath('validate.mjs'), '--require-ready'], {
      encoding: 'utf8',
    })
    assert.equal(ready.status, 1)
    assert.equal(JSON.parse(ready.stdout).readyForWp6Acceptance, false)
    const heldout = spawnSync(
      process.execPath,
      [scriptPath('prepare.mjs'), '--mode', 'encoding', '--split', 'heldout'],
      { encoding: 'utf8' },
    )
    assert.equal(heldout.status, 1)
    assert.match(heldout.stderr, /requires a supported frozen candidate/)
    assert.equal(heldout.stdout, '')
    assert.throws(
      () => validateFrozenCandidate({ candidateDigest: 'wrong' }, dataset, 'wrong'),
      /digest/,
    )
  })
  const directory = await mkdtemp(join(tmpdir(), 'dsh-calibration-self-check-'))
  try {
    await check(
      'embedding input rejects stale digests, duplicate keys, dimension errors and heldout leakage',
      async () => {
        const spec = SEMANTIC_MODELS.find((row) => row.key === 'lightweight')
        const entries = [
          ...backgroundEntries(dataset),
          ...['train', 'calibration'].flatMap((split) => splitEntries(dataset, split)),
        ]
        const random = randomOf(71)
        const file = {
          schemaVersion: 1,
          synthetic: true,
          generatedBy: 'synthetic-self-check: seeded random unit vectors, not model output',
          model: modelIdentity(spec),
          datasetDigest: dataset.digest,
          backgroundDigest: dataset.backgroundDigest,
          partitionDigests: dataset.partitionDigests,
          entries: entries.map((entry) => {
            const vector = Array.from({ length: spec.dimension }, () => random() - 0.5)
            const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0))
            return { key: entry.key, vector: vector.map((x) => x / norm) }
          }),
        }
        const path = join(directory, 'synthetic-vectors.json')
        await writeFile(path, JSON.stringify(file))
        const embeddings = await loadEmbeddings(path, dataset, ['train', 'calibration'])
        assert.equal(embeddings.synthetic, true)
        for (const mutate of [
          (bad) => {
            bad.datasetDigest = 'stale'
          },
          (bad) => {
            bad.entries.push(bad.entries[0])
          },
          (bad) => {
            bad.entries[0].vector.pop()
          },
          (bad) => {
            bad.entries[0].key = 'query:forbidden-heldout-key'
          },
        ]) {
          const bad = structuredClone(file)
          mutate(bad)
          await writeFile(path, JSON.stringify(bad))
          await assert.rejects(loadEmbeddings(path, dataset, ['train', 'calibration']))
        }
        // This is a numerical/pipeline check against explicitly synthetic random
        // vectors. No heldout features are created; no coefficients are saved.
        const candidate = await fitCandidate(dataset, embeddings)
        assert.equal(candidate.threshold, null)
        assert.equal(candidate.productionEligible, false)
        assert.equal(candidate.wp6Acceptance, false)
        assert.equal(candidate.status, 'failed-calibration-budget-or-support')
        assert.ok(candidate.classifier.coefficients.every(Number.isFinite))
        const content = { ...candidate }
        delete content.candidateDigest
        assert.equal(candidate.candidateDigest, digestOf(content))
        assert.throws(
          () => validateFrozenCandidate(candidate, dataset, candidate.candidateDigest),
          /No calibrated threshold/,
        )
      },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  print({
    status: 'passed',
    checks,
    modelLoaded: false,
    networkUsed: false,
    heldoutScored: false,
    fittedModelArtifactSaved: false,
    evidence: 'Pure-script self-checks only; synthetic vectors are not a model evaluation.',
  })
})
