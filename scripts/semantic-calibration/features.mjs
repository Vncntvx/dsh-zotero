import { cosineSimilarity as cosine } from '../../src/enrichment/semantic/tensor.ts'
export { cosine }
// Read-only adapter for externally supplied embeddings. Never loads a model.
// Input JSON: {schemaVersion:1, synthetic:false, generatedBy:"...", model:{...},
// datasetDigest, backgroundDigest, partitionDigests, entries:[{key,vector:[...]}]}.
// A preparation-only synthetic vector file is accepted iff generatedBy explicitly
// starts with "synthetic-self-check"; its output is always marked ineligible.
import { readFile } from 'node:fs/promises'
import { SEMANTIC_MODELS } from '../../src/enrichment-model-catalog.ts'
import {
  backgroundEntries,
  codepoints,
  digestOf,
  invariant,
  sha256,
  splitEntries,
} from './dataset.mjs'

/** @typedef {{ key: string, physicalKey: string, modelId: string, revision: string, dimension: number, maxTokens: number, pooling: string, normalize: boolean, queryPrefix: string, documentPrefix: string, files: unknown }} ModelIdentity */
/** @typedef {{ vectors: Map<string, number[]>, identity: unknown, synthetic: boolean, generatedBy: string, inputSha256: string }} Embeddings */

/**
 * The `Record<string, any>` arm only backs the dynamic `[key, spec[key]]`
 * reflection below; every caller still passes a full catalog entry.
 * @param {import('../../src/enrichment-model-catalog.ts').SemanticModelEntry & Record<string, any>} spec
 * @returns {ModelIdentity}
 */
export function modelIdentity(spec) {
  return /** @type {ModelIdentity} */ (
    Object.fromEntries(
      [
        'key',
        'physicalKey',
        'modelId',
        'revision',
        'dimension',
        'maxTokens',
        'pooling',
        'normalize',
        'queryPrefix',
        'documentPrefix',
        'files',
      ].map((key) => [key, spec[key]]),
    )
  )
}
/**
 * @param {string} path
 * @param {import('./dataset.mjs').Dataset} dataset
 * @param {readonly import('./dataset.mjs').Split[]} requestedSplits
 * @returns {Promise<Embeddings>}
 */
export async function loadEmbeddings(path, dataset, requestedSplits) {
  const bytes = await readFile(path)
  invariant(bytes.length <= 256 * 1024 * 1024, 'Embedding JSON exceeds 256 MiB preparation limit')
  const value = JSON.parse(bytes.toString('utf8'))
  invariant(
    value.schemaVersion === 1 &&
      typeof value.synthetic === 'boolean' &&
      typeof value.generatedBy === 'string' &&
      value.generatedBy.length > 8,
    'Missing embedding provenance',
  )
  invariant(
    !value.synthetic || value.generatedBy.startsWith('synthetic-self-check'),
    'Synthetic vectors must be explicitly marked as self-check data',
  )
  const spec = SEMANTIC_MODELS.find((candidate) => candidate.key === value.model?.key)
  invariant(
    spec && digestOf(value.model) === digestOf(modelIdentity(spec)),
    'Model identity differs from pinned catalog/inference contract',
  )
  invariant(
    value.datasetDigest === dataset.digest && value.backgroundDigest === dataset.backgroundDigest,
    'Stale dataset/background digest',
  )
  for (const split of requestedSplits)
    invariant(
      value.partitionDigests?.[split] === dataset.partitionDigests[split],
      `Stale/missing ${split} digest`,
    )
  invariant(Array.isArray(value.entries), 'Missing embedding entries')
  const expected = [
    ...backgroundEntries(dataset),
    ...requestedSplits.flatMap((split) => splitEntries(dataset, split)),
  ]
  const expectedKeys = new Set(expected.map((entry) => entry.key))
  const vectors = new Map()
  for (const entry of value.entries) {
    invariant(
      expectedKeys.has(entry.key),
      `Unexpected vector (including forbidden heldout leakage): ${entry.key}`,
    )
    invariant(!vectors.has(entry.key), `Duplicate embedding: ${entry.key}`)
    invariant(
      Array.isArray(entry.vector) &&
        entry.vector.length === spec.dimension &&
        entry.vector.every(Number.isFinite),
      `Invalid vector dimensions/values: ${entry.key}`,
    )
    const norm = Math.sqrt(
      entry.vector.reduce((/** @type {number} */ sum, /** @type {number} */ x) => sum + x * x, 0),
    )
    invariant(Number.isFinite(norm) && norm > 1e-12, `Zero/invalid vector: ${entry.key}`)
    invariant(!spec.normalize || Math.abs(norm - 1) <= 0.001, `Expected unit vector: ${entry.key}`)
    vectors.set(entry.key, entry.vector)
  }
  for (const key of expectedKeys) invariant(vectors.has(key), `Missing embedding: ${key}`)
  return {
    vectors,
    identity: value.model,
    synthetic: value.synthetic,
    generatedBy: value.generatedBy,
    inputSha256: sha256(bytes),
  }
}
/**
 * @template {import('./dataset.mjs').PairRow | { queryKey: string, documentKey: string, queryText: string, documentText: string }} T
 * @param {{ background: { families: { id: string, query: import('./dataset.mjs').Bilingual, document: import('./dataset.mjs').Bilingual }[] } }} dataset
 * @param {T[]} rows
 * @param {{ vectors: Map<string, number[]> }} embeddings
 * @param {number} k
 * @returns {(T & { features: number[] })[]}
 */
export function featureRows(dataset, rows, embeddings, k) {
  const bank = backgroundEntries(dataset)
  const bd = /** @type {number[][]} */ (
    bank.filter((row) => row.side === 'document').map((row) => embeddings.vectors.get(row.key))
  )
  const bq = /** @type {number[][]} */ (
    bank.filter((row) => row.side === 'query').map((row) => embeddings.vectors.get(row.key))
  )
  invariant(
    Number.isSafeInteger(k) && k > 0 && k <= Math.min(bd.length, bq.length),
    'Invalid bank top-k',
  )
  const qBaseline = new Map()
  const dBaseline = new Map()
  /**
   * @param {number[]} vector
   * @param {number[][]} reference
   */
  const topMean = (vector, reference) =>
    reference
      .map((other) => cosine(vector, other))
      .sort((a, b) => b - a)
      .slice(0, k)
      .reduce((a, b) => a + b, 0) / k
  return rows.map((row) => {
    const q = embeddings.vectors.get(row.queryKey)
    const d = embeddings.vectors.get(row.documentKey)
    invariant(q && d, 'Missing pair vector')
    if (!qBaseline.has(row.queryKey)) qBaseline.set(row.queryKey, topMean(q, bd))
    if (!dBaseline.has(row.documentKey)) dBaseline.set(row.documentKey, topMean(d, bq))
    const score = cosine(q, d)
    return {
      ...row,
      features: [
        score,
        score - qBaseline.get(row.queryKey),
        score - dBaseline.get(row.documentKey),
        Math.log1p(codepoints(row.queryText)),
        Math.log1p(codepoints(row.documentText)),
      ],
    }
  })
}
