// Deterministic Newton/IRLS ridge logistic regression, five numeric features.
// Objective: query-balanced mean log loss + lambda/2 * sum(slopes^2).
// Intercept is not penalized. Means/scales belong to the training fold only.
import { invariant } from './dataset.mjs'

export const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))
const softplus = (z) => Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z)))
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)

export function queryWeights(rows) {
  const counts = new Map()
  for (const row of rows) {
    const key = `${row.language}/${row.intentId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return rows.map((row) => 1 / counts.get(`${row.language}/${row.intentId}`))
}
function standardizer(rows, weights) {
  const width = rows[0].features.length
  const total = weights.reduce((a, b) => a + b, 0)
  const means = Array(width).fill(0)
  const scales = Array(width).fill(0)
  rows.forEach((row, i) =>
    row.features.forEach((value, j) => {
      means[j] += (value * weights[i]) / total
    }),
  )
  rows.forEach((row, i) =>
    row.features.forEach((value, j) => {
      scales[j] += ((value - means[j]) ** 2 * weights[i]) / total
    }),
  )
  return { means, scales: scales.map((variance) => (variance < 1e-20 ? 1 : Math.sqrt(variance))) }
}
export function featureVector(features, model) {
  invariant(
    Array.isArray(features) &&
      features.length === model.means.length &&
      features.every(Number.isFinite),
    'Invalid feature vector',
  )
  return [1, ...features.map((x, i) => (x - model.means[i]) / model.scales[i])]
}
export const predict = (features, model) =>
  sigmoid(dot(featureVector(features, model), model.coefficients))

function solve(matrix, vector) {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, vector[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let i = col + 1; i < n; i++) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i
    invariant(Math.abs(a[pivot][col]) > 1e-14, 'Singular logistic Hessian')
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const divisor = a[col][col]
    for (let j = col; j <= n; j++) a[col][j] /= divisor
    for (let i = 0; i < n; i++)
      if (i !== col) {
        const multiplier = a[i][col]
        for (let j = col; j <= n; j++) a[i][j] -= multiplier * a[col][j]
      }
  }
  return a.map((row) => row[n])
}
export function fitLogistic(rows, lambda, { maxIterations = 100, tolerance = 1e-8 } = {}) {
  invariant(
    rows.length > 0 && Number.isFinite(lambda) && lambda > 0,
    'Empty rows or invalid ridge penalty',
  )
  invariant(
    rows.some((row) => row.label === 0) && rows.some((row) => row.label === 1),
    'Training requires both labels',
  )
  for (const row of rows)
    invariant(
      row.features?.length === 5 &&
        row.features.every(Number.isFinite) &&
        [0, 1].includes(row.label),
      'Invalid training row',
    )
  const weights = queryWeights(rows)
  const total = weights.reduce((a, b) => a + b, 0)
  const model = { ...standardizer(rows, weights), coefficients: Array(6).fill(0), lambda }
  const x = rows.map((row) => featureVector(row.features, model))
  const objective = (beta) =>
    rows.reduce((loss, row, i) => {
      const z = dot(x[i], beta)
      return loss + (weights[i] / total) * (softplus(z) - row.label * z)
    }, 0) +
    (lambda / 2) * beta.slice(1).reduce((sum, value) => sum + value * value, 0)
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const beta = model.coefficients
    const gradient = beta.map((value, j) => (j === 0 ? 0 : lambda * value))
    const hessian = beta.map((_, j) => beta.map((__, k) => (j === k && j !== 0 ? lambda : 0)))
    rows.forEach((row, i) => {
      const probability = sigmoid(dot(x[i], beta))
      const weight = weights[i] / total
      for (let j = 0; j < beta.length; j++) {
        gradient[j] += weight * (probability - row.label) * x[i][j]
        for (let k = 0; k < beta.length; k++)
          hessian[j][k] += weight * probability * (1 - probability) * x[i][j] * x[i][k]
      }
    })
    if (Math.max(...gradient.map(Math.abs)) < tolerance)
      return { ...model, iterations: iteration, converged: true, objective: objective(beta) }
    const step = solve(hessian, gradient)
    const descent = dot(gradient, step)
    const before = objective(beta)
    let rate = 1
    let candidate
    for (let line = 0; line < 50; line++) {
      candidate = beta.map((value, j) => value - rate * step[j])
      if (objective(candidate) <= before - 1e-4 * rate * descent) break
      rate /= 2
    }
    invariant(rate > 2 ** -49 && candidate.every(Number.isFinite), 'Logistic line search failed')
    model.coefficients = candidate
  }
  throw new Error('Ridge logistic fitting did not converge')
}
export function logLoss(rows, model) {
  const weights = queryWeights(rows)
  const total = weights.reduce((a, b) => a + b, 0)
  return rows.reduce((sum, row, i) => {
    const z = dot(featureVector(row.features, model), model.coefficients)
    return sum + (weights[i] / total) * (softplus(z) - row.label * z)
  }, 0)
}

export function groupedSelect(rowsByK, { kCandidates, ridgeCandidates, folds }) {
  const firstRows = rowsByK.get(kCandidates[0])
  const familyIds = [...new Set(firstRows.map((row) => row.familyId))].sort()
  invariant(familyIds.length >= folds * 2, 'Too few train families for grouped CV')
  const foldByFamily = new Map(familyIds.map((id, i) => [id, i % folds]))
  const reports = []
  for (const k of kCandidates)
    for (const lambda of ridgeCandidates) {
      const rows = rowsByK.get(k)
      const losses = []
      for (let fold = 0; fold < folds; fold++) {
        const training = rows.filter((row) => foldByFamily.get(row.familyId) !== fold)
        const validation = rows.filter(
          (row) =>
            foldByFamily.get(row.familyId) === fold &&
            foldByFamily.get(row.documentFamilyId) === fold,
        )
        // Hold out document families as well as query families. No validation
        // document may influence either the fit or its fold standardization.
        const trainFamilies = new Set(training.map((row) => row.familyId))
        const strictTraining = training.filter((row) => trainFamilies.has(row.documentFamilyId))
        invariant(validation.length > 0, 'Empty validation fold')
        const fitted = fitLogistic(strictTraining, lambda)
        losses.push(logLoss(validation, fitted))
      }
      reports.push({
        k,
        lambda,
        meanLogLoss: losses.reduce((a, b) => a + b, 0) / losses.length,
        foldLosses: losses,
      })
    }
  reports.sort((a, b) => a.meanLogLoss - b.meanLogLoss || a.k - b.k || a.lambda - b.lambda)
  return { selected: reports[0], reports, foldByFamily: Object.fromEntries(foldByFamily) }
}
