import type { AdmissionRules } from '../../src/enrichment/semantic/admission.js'
import type { SemanticModelEntry } from '../../src/enrichment-model-catalog.js'
import type { AdmissionInputs } from './admission-data.mjs'

export interface AdmissionMetrics {
  cases: number
  recallAt1: number
  recallAt4: number
  mrr: number
  precisionAt4: number | null
  returned: number
}
export interface AdmissionMeasurement extends Readonly<Record<string, unknown>> {
  model: Pick<
    SemanticModelEntry,
    'key' | 'modelId' | 'physicalKey' | 'revision' | 'dimension' | 'files'
  >
  profile: AdmissionRules
  proposal: { floor: number; margin: number; status: string }
  datasetDigest: string
  inputDigest: string
  embeddingsSha256: string
  weakestSame: number
  strongestCross: number
  unrelatedMax: number
  unrelatedCorpora: number
  unrelatedHits: number
  cases: readonly {
    id: string
    language: string
    kind: string
    relevant: readonly number[]
    cosines: readonly number[]
    top4: readonly number[]
    unrelatedHits: number
    lexicalTop4: readonly number[]
  }[]
  summaries: Readonly<
    Record<
      'all' | 'paraphrase' | 'lexical' | 'duplicate',
      { semantic: AdmissionMetrics; lexical: AdmissionMetrics }
    >
  >
}
export function measureAdmissionVectors(
  request: AdmissionInputs,
  encoded: unknown,
  inputSha256: string,
  profile?: AdmissionRules,
): AdmissionMeasurement
