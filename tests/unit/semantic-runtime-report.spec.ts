/**
 * Historical logistic-calibration diagnostics, checked as archived metadata.
 * This spec does not prove model execution or the current cosine policies.
 * semantic-admission-measurement.spec.ts recomputes those policies from the
 * separately archived real vectors without loading a model or using network.
 * @module tests/unit/semantic-runtime-report
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEMANTIC_MODELS } from '../../src/enrichment-model-catalog.js'

interface FitRow {
  readonly status: string
  readonly threshold: number | null
  readonly k: number
  readonly lambda: number
  readonly trainingRows: number
  readonly calibrationRows: number
  readonly candidateDigest: string
  readonly classifier: {
    readonly coefficients: readonly number[]
    readonly means: readonly number[]
    readonly scales: readonly number[]
  }
}

interface ModelRow {
  readonly model: string
  readonly physicalKey: string
  readonly modelId: string
  readonly revision: string
  readonly dimension: number
  readonly diskBytes: number
  readonly durationSeconds: number
  readonly peakRssBytes: number
  readonly fit: FitRow
  readonly heldoutRun: boolean
  readonly heldoutReason?: string
  readonly recallAt4: number
  readonly mrr: number
  readonly genericTop2: number
  readonly unrelatedCorpusSemanticHits: number
  readonly onTopicSemanticHit: boolean
  readonly diagnosticThreshold: number
  readonly diagnosticOnly: boolean
}

interface RuntimeReport {
  readonly schemaVersion: number
  readonly kind: string
  readonly models: readonly ModelRow[]
  readonly verdict: {
    readonly sixModelMatrixRun: boolean
    readonly allModelsInferenceOk: boolean
    readonly feasibleCalibrationArtifacts: number
    readonly wp6AcceptanceMet: boolean
    readonly blockers: readonly string[]
  }
}

const report = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'semantic-calibration', 'runtime-report.json'),
    'utf8',
  ),
) as RuntimeReport

describe('WP6 six-model runtime report', () => {
  it('covers every catalog tier exactly once with the catalog identity', () => {
    expect(report.kind).toBe('wp6-six-model-runtime-report')
    expect(report.models.map((row) => row.model).sort()).toEqual(
      SEMANTIC_MODELS.map((model) => model.key).sort(),
    )
    for (const row of report.models) {
      const spec = SEMANTIC_MODELS.find((model) => model.key === row.model)!
      expect(row.physicalKey).toBe(spec.physicalKey)
      expect(row.modelId).toBe(spec.modelId)
      expect(row.revision).toBe(spec.revision)
      expect(row.dimension).toBe(spec.dimension)
    }
  })

  it('retains finite diagnostic resource metadata per tier', () => {
    for (const row of report.models) {
      expect(row.diskBytes).toBeGreaterThan(0)
      expect(row.durationSeconds).toBeGreaterThan(0)
      expect(row.peakRssBytes).toBeGreaterThan(0)
      expect(row.fit.trainingRows).toBeGreaterThan(0)
      expect(row.fit.calibrationRows).toBeGreaterThan(0)
      expect(row.fit.candidateDigest).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('records a complete finite classifier fit for every tier', () => {
    for (const row of report.models) {
      const { coefficients, means, scales } = row.fit.classifier
      expect(coefficients).toHaveLength(6)
      expect(means).toHaveLength(5)
      expect(scales).toHaveLength(5)
      expect([...coefficients, ...means, ...scales].every(Number.isFinite)).toBe(true)
      expect(scales.every((scale) => scale > 0)).toBe(true)
      expect(row.fit.k).toBeGreaterThan(0)
      expect(row.fit.lambda).toBeGreaterThan(0)
    }
  })

  it('keeps the calibration status consistent with its threshold and heldout metadata', () => {
    const feasible = report.models.filter((row) => row.fit.threshold !== null)
    for (const row of report.models) {
      if (row.fit.threshold === null) expect(row.fit.status).toMatch(/^failed-/)
      else {
        expect(row.fit.threshold).toBeGreaterThanOrEqual(0)
        expect(row.fit.threshold).toBeLessThanOrEqual(1)
      }
      if (!row.heldoutRun) expect(row.heldoutReason).toBeTruthy()
      expect(typeof row.diagnosticOnly).toBe('boolean')
    }
    expect(report.verdict.feasibleCalibrationArtifacts).toBe(feasible.length)
    if (report.verdict.wp6AcceptanceMet) expect(feasible).toHaveLength(SEMANTIC_MODELS.length)
    else expect(report.verdict.blockers.length).toBeGreaterThan(0)
  })

  it('records diagnostic effect metrics without requiring a particular success or failure', () => {
    for (const row of report.models) {
      expect(row.recallAt4).toBeGreaterThanOrEqual(0)
      expect(row.recallAt4).toBeLessThanOrEqual(1)
      expect(row.mrr).toBeGreaterThanOrEqual(0)
      expect(row.mrr).toBeLessThanOrEqual(1)
      expect(row.genericTop2).toBeGreaterThanOrEqual(0)
      expect(row.unrelatedCorpusSemanticHits).toBeGreaterThanOrEqual(0)
      expect(typeof row.onTopicSemanticHit).toBe('boolean')
    }
  })
})
