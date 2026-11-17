import type { RecallCase } from '../../tests/helpers/semantic-recall-fixtures.js'
import type { SemanticModelEntry } from '../../src/enrichment-model-catalog.js'

export interface AdmissionInputs {
  schemaVersion: number
  protocol: string
  datasetDigest: string
  cases: readonly RecallCase[]
  entries: readonly { key: string; side: 'query' | 'document'; text: string }[]
  requiredModelIdentities: readonly Readonly<Record<string, unknown>>[]
  provenance: string
}
export const ADMISSION_MEASUREMENT_PROTOCOL: string
export function prepareAdmissionInputs(): AdmissionInputs
export function checkAdmissionInputs(request: unknown): AdmissionInputs
export function admissionInputsForModel(
  request: AdmissionInputs,
  model: SemanticModelEntry,
): {
  cases: readonly RecallCase[]
  entries: AdmissionInputs['entries']
  inputDigest: string
}
