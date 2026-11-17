/** Frozen regression inputs for measuring the shipped cosine admission rules. */
import { RECALL_CASES } from '../../tests/helpers/semantic-recall-fixtures.ts'
import { SEMANTIC_MODELS } from '../../src/enrichment-model-catalog.ts'
import { digestOf, invariant, textKey } from './dataset.mjs'
import { modelIdentity } from './features.mjs'

export const ADMISSION_MEASUREMENT_PROTOCOL = 'fixed-floor-margin-regression-v1'

export function prepareAdmissionInputs() {
  const cases = RECALL_CASES.map((row) => ({
    ...row,
    passages: [...row.passages],
    relevant: [...row.relevant],
  }))
  const entries = new Map()
  const add = (side, text) => {
    const key = textKey(side, text)
    entries.set(key, { key, side, text })
  }
  for (const row of cases) {
    add('query', row.query)
    for (const passage of row.passages) add('document', passage)
  }
  return {
    schemaVersion: 1,
    protocol: ADMISSION_MEASUREMENT_PROTOCOL,
    datasetDigest: digestOf(cases),
    cases,
    entries: [...entries.values()],
    requiredModelIdentities: SEMANTIC_MODELS.map(modelIdentity),
    provenance:
      'Authored bilingual regression cases; no empirical extraction, independent annotation or heldout generalization claim.',
  }
}

export function checkAdmissionInputs(request) {
  const expected = prepareAdmissionInputs()
  invariant(
    request?.schemaVersion === 1 && request.protocol === expected.protocol,
    'Invalid admission input protocol',
  )
  invariant(
    request.datasetDigest === expected.datasetDigest &&
      digestOf(request.cases) === expected.datasetDigest,
    'Stale or changed admission cases',
  )
  invariant(
    digestOf(request.entries) === digestOf(expected.entries),
    'Missing, changed or additional encoding input',
  )
  invariant(
    digestOf(request.requiredModelIdentities) === digestOf(expected.requiredModelIdentities),
    'Stale model identities',
  )
  return expected
}

export function admissionInputsForModel(request, model) {
  checkAdmissionInputs(request)
  const cases = request.cases.filter(
    (row) => model.languages.includes('*') || model.languages.includes(row.language),
  )
  const keys = new Set(
    cases.flatMap((row) => [
      textKey('query', row.query),
      ...row.passages.map((text) => textKey('document', text)),
    ]),
  )
  const entries = request.entries.filter((entry) => keys.has(entry.key))
  return { cases, entries, inputDigest: digestOf(entries) }
}
