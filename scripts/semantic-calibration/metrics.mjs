// Aggregate semantic admission only. BM25/RRF outputs are never counted here.
import { digestOf, invariant } from './dataset.mjs'
import { predict } from './logistic.mjs'
import { binomialBounds, clusterBootstrap } from './statistics.mjs'

export function scoreRows(rows, model) {
  return rows.map((row) => ({ ...row, confidence: predict(row.features, model) }))
}
export function admissionSummary(rows, threshold, protocol, alpha = protocol.alpha) {
  invariant(Number.isFinite(threshold) && threshold >= 0 && threshold <= 1, 'Invalid threshold')
  const perLanguage = {}
  for (const language of protocol.languages) {
    const selected = rows.filter((row) => row.language === language)
    const intents = new Map()
    const pairs = new Map()
    const familyTotals = new Map()
    for (const row of selected) {
      const intent = intents.get(row.intentId) ?? {
        familyId: row.familyId,
        negative: row.negativeIntent,
        admitted: false,
      }
      if (row.confidence >= threshold) {
        intent.admitted = true
        const key = `${row.intentId}/${row.documentKey}`
        const old = pairs.get(key)
        invariant(!old || old.label === row.label, 'Conflicting relevance labels across phrasings')
        // Collapse phrasings and query directions: a returned source text pair
        // can enter once. Translated document texts remain correlated pairs.
        pairs.set(key, row)
      }
      intents.set(row.intentId, intent)
    }
    const negative = [...intents.values()].filter((intent) => intent.negative)
    const failures = negative.filter((intent) => intent.admitted).length
    let correct = 0
    for (const row of pairs.values()) {
      correct += row.label
      const cluster = familyTotals.get(row.familyId) ?? { numerator: 0, denominator: 0 }
      cluster.numerator += row.label
      cluster.denominator++
      familyTotals.set(row.familyId, cluster)
    }
    const negativeClusters = [...new Set(negative.map((intent) => intent.familyId))].map(
      (familyId) => ({
        numerator: negative.filter((intent) => intent.familyId === familyId && intent.admitted)
          .length,
        denominator: negative.filter((intent) => intent.familyId === familyId).length,
      }),
    )
    // Include zero-return families when resampling precision clusters.
    for (const row of selected)
      if (!familyTotals.has(row.familyId))
        familyTotals.set(row.familyId, { numerator: 0, denominator: 0 })
    perLanguage[language] = {
      negativeAnyHit: binomialBounds(failures, negative.length, alpha),
      mixedReturnedPrecision: binomialBounds(correct, pairs.size, alpha),
      negativeFamilyBootstrap: clusterBootstrap(negativeClusters, protocol),
      precisionFamilyBootstrap: clusterBootstrap([...familyTotals.values()], protocol),
      rawNegativeCountSufficient: negative.length >= protocol.minimumNegativeQueriesPerLanguage,
      uniqueIntents: intents.size,
    }
  }
  return {
    threshold,
    perLanguage,
    ciLimitation:
      'Exact bounds assume independent Bernoulli units. Distinct synthetic queries are not proof of independence; returned pairs share queries/documents. Cluster bootstrap is diagnostic, never an external validity certificate.',
  }
}
export function selectThreshold(rows, protocol) {
  // Fixed finite grid makes selection multiplicity explicit. Never adapt the
  // search grid to observed scores or choose a threshold on heldout outcomes.
  const divisor = protocol.thresholdCandidates.length * protocol.languages.length * 2
  const alpha = protocol.alpha / divisor
  const candidates = protocol.thresholdCandidates.map((threshold) => {
    const summary = admissionSummary(rows, threshold, protocol, alpha)
    const feasible = protocol.languages.every((language) => {
      const entry = summary.perLanguage[language]
      return (
        entry.rawNegativeCountSufficient &&
        entry.negativeAnyHit.upper <= protocol.negativeAnyHitUpperTarget &&
        entry.mixedReturnedPrecision.lower >= protocol.mixedPrecisionLowerTarget
      )
    })
    return { ...summary, feasible }
  })
  return {
    selected: candidates.find((entry) => entry.feasible)?.threshold ?? null,
    candidates,
    alphaPerBound: alpha,
    bonferroniDivisor: divisor,
    policy:
      'Lowest feasible predeclared threshold, calibration only; insufficient support produces null.',
  }
}
export function perIntentOutcomes(rows, threshold) {
  const grouped = new Map()
  for (const row of rows) {
    const key = `${row.language}/${row.intentId}`
    const outcome = grouped.get(key) ?? {
      unit: key,
      familyId: row.familyId,
      negative: row.negativeIntent,
      examinedPairs: 0,
      admitted: [],
    }
    outcome.examinedPairs++
    if (row.confidence >= threshold)
      outcome.admitted.push({
        queryKey: row.queryKey,
        documentKey: row.documentKey,
        documentLanguage: row.documentLanguage,
        phrasing: row.phrasing,
        label: row.label,
        confidence: row.confidence,
        rawCosine: row.features[0],
      })
    grouped.set(key, outcome)
  }
  return [...grouped.values()]
}
export function regressionMetrics(rows, threshold) {
  const grouped = new Map()
  for (const row of rows.filter((entry) => !entry.negativeIntent && entry.phrasing === 0)) {
    const key = `${row.language}-${row.documentLanguage}/${row.intentId}`
    const group = grouped.get(key) ?? []
    group.push(row)
    grouped.set(key, group)
  }
  let recall = 0
  let mrr = 0
  for (const group of grouped.values()) {
    const positives = group.filter((row) => row.label === 1).length
    const ranking = group
      .filter((row) => row.confidence >= threshold)
      .sort(
        (a, b) => b.confidence - a.confidence || a.documentKey.localeCompare(b.documentKey, 'en'),
      )
    recall += ranking.slice(0, 4).filter((row) => row.label === 1).length / positives
    const first = ranking.findIndex((row) => row.label === 1)
    mrr += first < 0 ? 0 : 1 / (first + 1)
  }
  return {
    cases: grouped.size,
    recallAt4: grouped.size ? recall / grouped.size : null,
    mrr: grouped.size ? mrr / grouped.size : null,
    genericTop2: null,
    legacy24RegressionRun: false,
    limitation:
      'Synthetic semantic-only mixed pool. Does not establish original hybrid regression, generic-control result, runtime chunking or source/renderer integration.',
    pairingDigest: digestOf(
      rows.map((row) => [row.intentId, row.queryKey, row.documentKey, row.label]),
    ),
  }
}
