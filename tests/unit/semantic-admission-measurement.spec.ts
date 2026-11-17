/** Offline recomputation of manually generated model vectors; no model or socket is opened. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SEMANTIC_MODELS } from '../../src/enrichment-model-catalog.js'
import { ADMISSION_PROFILES } from '../../src/enrichment/semantic/model-profiles.js'
import { prepareAdmissionInputs } from '../../scripts/semantic-calibration/admission-data.mjs'
import {
  measureAdmissionVectors,
  type AdmissionMeasurement,
} from '../../scripts/semantic-calibration/measure-admission.mjs'

const root = new URL('../fixtures/semantic-admission/', import.meta.url)
const report = JSON.parse(readFileSync(new URL('model-profiles-report.json', root), 'utf8')) as {
  datasetDigest: string
  models: Array<AdmissionMeasurement & { vectorFile: string }>
  previousProfiles: {
    hybrid: {
      profile: AdmissionMeasurement['profile']
      unrelatedHits: number
      summaries: AdmissionMeasurement['summaries']
    }
  }
}
const request = prepareAdmissionInputs()
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

describe('archived real-vector admission measurement', () => {
  it('covers every current model identity and the exact frozen dataset', () => {
    expect(report.models.map((row) => row.model.key)).toEqual(
      SEMANTIC_MODELS.map((model) => model.key),
    )
    expect(report.datasetDigest).toBe(request.datasetDigest)
    expect(request.cases).toHaveLength(24)
    expect(request.cases.filter((row) => row.kind === 'paraphrase')).toHaveLength(20)
  })
  it.each(SEMANTIC_MODELS)(
    'recomputes every $key observation, metric and profile from its archived vectors',
    (model) => {
      const archived = report.models.find((row) => row.model.key === model.key)!
      expect(archived.vectorFile).toBe(`vectors/${model.key}.json`)
      const bytes = readFileSync(new URL(archived.vectorFile, root))
      const { vectorFile: _file, ...expected } = archived
      const measured = measureAdmissionVectors(
        request,
        JSON.parse(bytes.toString('utf8')),
        digest(bytes),
      )
      expect(measured).toEqual(expected)
      expect(measured.profile).toEqual(ADMISSION_PROFILES[model.key])
      expect(measured.profile.floor).toBeGreaterThan(measured.unrelatedMax)
      expect(measured.unrelatedHits).toBe(0)
      expect(measured.summaries.all.semantic.cases).toBe(model.key === 'english' ? 12 : 24)
      expect(measured.summaries.paraphrase.lexical.recallAt4).toBe(0)
      expect(measured.summaries.all.lexical.recallAt4).toBeCloseTo(4 / 24, 8)
    },
  )
  it('reproduces the hybrid false hits before its measured floor correction', () => {
    const row = report.models.find((row) => row.model.key === 'hybrid')!
    const bytes = readFileSync(new URL(row.vectorFile, root))
    const previous = measureAdmissionVectors(
      request,
      JSON.parse(bytes.toString('utf8')),
      digest(bytes),
      report.previousProfiles.hybrid.profile,
    )
    expect(previous.unrelatedHits).toBe(2)
    expect(previous.unrelatedHits).toBe(report.previousProfiles.hybrid.unrelatedHits)
    expect(previous.summaries).toEqual(report.previousProfiles.hybrid.summaries)
    expect(row.unrelatedHits).toBe(0)
    expect(row.summaries.paraphrase.semantic.recallAt4).toBe(
      previous.summaries.paraphrase.semantic.recallAt4,
    )
  })
  it.each(['stale-dataset', 'duplicate-key', 'wrong-dimension', 'synthetic'])(
    'refuses %s vectors rather than producing plausible measurement numbers',
    (kind) => {
      const row = report.models[0]!
      const encoded = JSON.parse(readFileSync(new URL(row.vectorFile, root), 'utf8'))
      if (kind === 'stale-dataset') encoded.datasetDigest = '0'.repeat(64)
      if (kind === 'duplicate-key') encoded.entries[1] = encoded.entries[0]
      if (kind === 'wrong-dimension') encoded.entries[0].vector.pop()
      if (kind === 'synthetic') encoded.synthetic = true
      expect(() => measureAdmissionVectors(request, encoded, '0'.repeat(64))).toThrow()
    },
  )
})
