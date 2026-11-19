/** Offline measurement of actual model vectors; this module never opens a model or socket. */
import { readFile } from 'node:fs/promises'
import { SEMANTIC_MODELS } from '../../src/enrichment-model-catalog.ts'
import { admittedIndexes, validateAdmissionRules } from '../../lib/enrichment/semantic/admission.js'
import { ADMISSION_PROFILES } from '../../lib/enrichment/semantic/model-profiles.js'
import { cosineSimilarity } from '../../src/enrichment/semantic/tensor.ts'
import { rankChunks } from '../../lib/evidence.js'
import { admissionInputsForModel, prepareAdmissionInputs } from './admission-data.mjs'
import { cli, digestOf, invariant, isMain, options, print, sha256, textKey } from './dataset.mjs'
import { modelIdentity } from './features.mjs'

/** @typedef {{ schemaVersion: number, protocol: string, synthetic: boolean, datasetDigest: string, inputDigest: string, generatedBy: string, generatedAt: string, durationMs: number, runtime: unknown, model: import('./features.mjs').ModelIdentity, entries: { key: string, vector: number[] }[] }} EncodingFile */
/** @typedef {{ relevant: readonly number[], top4: readonly number[], lexicalTop4: readonly number[] }} CaseRow */

/** @param {number} value */
const round = (value) => Number(value.toFixed(9))
/**
 * @param {import('./admission-data.mjs').AdmissionInputs} request
 * @param {EncodingFile} encoded
 * @param {string} inputSha256
 * @param {import('../../lib/enrichment/semantic/admission.js').AdmissionRules} [profile]
 */
export function measureAdmissionVectors(request, encoded, inputSha256, profile) {
  const model = SEMANTIC_MODELS.find((model) => model.key === encoded?.model?.key)
  invariant(
    model && digestOf(encoded.model) === digestOf(modelIdentity(model)),
    'Model identity differs from the pinned catalog',
  )
  const input = admissionInputsForModel(request, model)
  invariant(
    encoded.schemaVersion === 1 &&
      encoded.protocol === request.protocol &&
      encoded.synthetic === false,
    'Actual model vectors with matching protocol are required',
  )
  invariant(
    encoded.datasetDigest === request.datasetDigest && encoded.inputDigest === input.inputDigest,
    'Stale vector dataset or input digest',
  )
  invariant(
    typeof encoded.generatedBy === 'string' &&
      encoded.generatedBy.includes('production semantic Worker'),
    'Missing actual encoder provenance',
  )
  invariant(
    Array.isArray(encoded.entries) && encoded.entries.length === input.entries.length,
    'Missing or additional vectors',
  )
  const expected = new Set(input.entries.map((entry) => entry.key)),
    vectors = new Map()
  for (const entry of encoded.entries) {
    invariant(expected.has(entry.key) && !vectors.has(entry.key), 'Unknown or duplicate vector key')
    invariant(
      Array.isArray(entry.vector) &&
        entry.vector.length === model.dimension &&
        entry.vector.every(Number.isFinite),
      'Invalid vector dimension or finite values',
    )
    const vector = new Float32Array(entry.vector)
    invariant(
      vector.some((value) => value !== 0),
      'Zero model vector',
    )
    vectors.set(entry.key, vector)
  }
  const observations = input.cases.map((row) => {
    const query = vectors.get(textKey('query', row.query))
    const cosines = row.passages.map((text) =>
      cosineSimilarity(query, vectors.get(textKey('document', text))),
    )
    const lexical = rankChunks(
      row.query,
      row.passages.map((text, index) => ({ text, index })),
    )
      .filter((match) => match.score > 0)
      .map((match) => match.index)
    return { ...row, cosines, lexical }
  })
  const strongestCross = Math.max(
    ...observations.flatMap((row) =>
      row.cosines.filter((_, index) => !row.relevant.includes(index)),
    ),
  )
  const weakestSame = Math.min(
    ...observations.flatMap((row) => row.relevant.map((index) => row.cosines[index])),
  )
  const unrelatedMax = strongestCross
  invariant(unrelatedMax < 1, 'No separating absolute floor exists')
  // Strictly above every measured answer-removed corpus. The 0.001 safety
  // distance is declared in the protocol, not estimated from heldout data.
  const floor = Math.min(1, Math.ceil((unrelatedMax + 0.001) * 1_000_000) / 1_000_000)
  const eligible = observations.filter((row) =>
    row.relevant.some((index) => row.cosines[index] >= floor),
  )
  const requiredMargins = eligible.flatMap((row) =>
    row.relevant
      .filter((index) => row.cosines[index] >= floor)
      .map((index) => Math.max(...row.cosines) - row.cosines[index]),
  )
  const margin = Math.ceil(Math.max(0, ...requiredMargins) * 1_000_000) / 1_000_000
  const rules = validateAdmissionRules(
    profile ?? ADMISSION_PROFILES[model.key],
    'measurement profile',
  )
  const caseRows = observations.map((row) => {
    const ranked = admittedIndexes(row.cosines, rules)
    const negativeCosines = row.cosines.filter((_, index) => !row.relevant.includes(index))
    return {
      id: row.id,
      language: row.language,
      kind: row.kind,
      relevant: row.relevant,
      cosines: row.cosines,
      top4: ranked.slice(0, 4),
      unrelatedHits: admittedIndexes(negativeCosines, rules).length,
      lexicalTop4: row.lexical.slice(0, 4),
    }
  })
  /**
   * @param {CaseRow[]} rows
   * @param {'top4' | 'lexicalTop4'} field
   */
  const metrics = (rows, field) => {
    let at1 = 0,
      at4 = 0,
      reciprocal = 0,
      precision = 0,
      returned = 0
    for (const row of rows) {
      const ranked = row[field]
      at1 += Number(row.relevant.includes(ranked[0]))
      at4 += Number(ranked.some((index) => row.relevant.includes(index)))
      const first = ranked.findIndex((index) => row.relevant.includes(index))
      reciprocal += first < 0 ? 0 : 1 / (first + 1)
      precision += ranked.filter((index) => row.relevant.includes(index)).length
      returned += ranked.length
    }
    return {
      cases: rows.length,
      recallAt1: round(at1 / rows.length),
      recallAt4: round(at4 / rows.length),
      mrr: round(reciprocal / rows.length),
      precisionAt4: returned === 0 ? null : round(precision / returned),
      returned,
    }
  }
  const summaries = Object.fromEntries(
    ['all', 'paraphrase', 'lexical', 'duplicate'].map((kind) => {
      const rows = caseRows.filter((row) => kind === 'all' || row.kind === kind)
      return [kind, { semantic: metrics(rows, 'top4'), lexical: metrics(rows, 'lexicalTop4') }]
    }),
  )
  return {
    model: modelIdentity(model),
    profile: rules,
    proposal: { floor, margin, status: 'measurement-only; requires explicit profile review' },
    floorProtocol:
      'ceil((strongest measured answer-removed cosine + 0.001) * 1e6) / 1e6; capped at 1',
    marginProtocol:
      'The shipped margin is a fixed policy limit. The proposal reports the smallest margin supported by this single-answer dataset; it does not establish an optimal multi-answer margin.',
    datasetDigest: request.datasetDigest,
    inputDigest: input.inputDigest,
    embeddingsSha256: inputSha256,
    weakestSame,
    strongestCross,
    unrelatedMax,
    summaries,
    unrelatedCorpora: caseRows.length,
    unrelatedHits: caseRows.reduce((sum, row) => sum + row.unrelatedHits, 0),
    cases: caseRows,
    generatedBy: encoded.generatedBy,
    generatedAt: encoded.generatedAt,
    durationMs: encoded.durationMs,
    runtime: encoded.runtime,
    limitation:
      'Same authored regression set selects and measures these rules; no heldout or production false-positive guarantee. Answer-removed controls contain only the seven original non-answer passages. Margin support is limited by the relevant labels in this dataset.',
  }
}

if (isMain(import.meta.url))
  cli(async () => {
    const args = options(process.argv.slice(2), ['--embeddings', '--help'])
    if (args['--help']) {
      process.stdout.write(
        'node scripts/semantic-calibration/measure-admission.mjs --embeddings MODEL.json\nPure offline measurement of one actual vector file; JSON report goes to stdout.\n',
      )
      return
    }
    invariant(args['--embeddings'], 'Specify --embeddings')
    const bytes = await readFile(/** @type {string} */ (args['--embeddings']))
    invariant(bytes.length <= 256 * 1024 * 1024, 'Vector input exceeds 256 MiB')
    print(
      measureAdmissionVectors(
        prepareAdmissionInputs(),
        JSON.parse(/** @type {string} */ (/** @type {unknown} */ (bytes))),
        sha256(bytes),
      ),
    )
  })
