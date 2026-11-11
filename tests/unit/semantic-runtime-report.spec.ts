/**
 * Six-model runtime report guard.
 *
 * The committed report records the real six-model run that motivated fixing
 * admission in code: every tier was downloaded, verified, encoded offline and
 * fitted, and none produced a feasible threshold on the then-current synthetic
 * dataset. This spec keeps that record honest — it fails if the report gains a
 * passing acceptance claim, a fabricated threshold, a missing tier, or a shape
 * no real fit produced. It reads a JSON fixture only: no model is loaded.
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

  it('records real inference work per tier', () => {
    for (const row of report.models) {
      expect(row.diskBytes).toBeGreaterThan(100 * 1024 * 1024)
      expect(row.durationSeconds).toBeGreaterThan(10)
      expect(row.peakRssBytes).toBeGreaterThan(256 * 1024 * 1024)
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

  it('holds no feasible threshold and therefore no production artifact', () => {
    for (const row of report.models) {
      expect(row.fit.status).toBe('failed-calibration-budget-or-support')
      expect(row.fit.threshold).toBeNull()
      expect(row.heldoutRun).toBe(false)
      expect(row.heldoutReason).toBeTruthy()
      expect(row.diagnosticOnly).toBe(true)
    }
    expect(report.verdict.feasibleCalibrationArtifacts).toBe(0)
    expect(report.verdict.wp6AcceptanceMet).toBe(false)
    expect(report.verdict.blockers.length).toBeGreaterThan(0)
  })

  it('records the real measured effect instead of an acceptance pass', () => {
    for (const row of report.models) {
      // The measured effect is the lexical baseline; nothing semantic passes.
      expect(row.recallAt4).toBeLessThan(0.9)
      expect(row.mrr).toBeLessThan(0.75)
      expect(row.genericTop2).toBe(0)
      // The calibrated route does refuse a wholly unrelated corpus.
      expect(row.unrelatedCorpusSemanticHits).toBe(0)
      expect(row.onTopicSemanticHit).toBe(false)
    }
  })
})
