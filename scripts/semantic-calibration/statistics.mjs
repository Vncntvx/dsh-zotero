// Exact one-sided Clopper-Pearson bounds and deterministic cluster diagnostics.
import { invariant } from './dataset.mjs'

function logGamma(z) {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
    12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
  ]
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  z--
  let x = 0.9999999999998099
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1)
  const t = z + p.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}
function betaFraction(a, b, x) {
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + aa * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + aa / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 3e-14) return h
  }
  throw new Error('Incomplete-beta evaluation did not converge')
}
function betaCdf(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const term = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  )
  return x < (a + 1) / (a + b + 2)
    ? (term * betaFraction(a, b, x)) / a
    : 1 - (term * betaFraction(b, a, 1 - x)) / b
}
function betaQuantile(probability, a, b) {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 90; i++) {
    const mid = (lo + hi) / 2
    if (betaCdf(mid, a, b) < probability) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
export function binomialBounds(successes, trials, alpha = 0.05) {
  invariant(
    Number.isSafeInteger(trials) &&
      Number.isSafeInteger(successes) &&
      trials >= 0 &&
      successes >= 0 &&
      successes <= trials,
    'Invalid binomial counts',
  )
  invariant(alpha > 0 && alpha < 1, 'Invalid alpha')
  if (trials === 0)
    return {
      successes,
      trials,
      estimate: null,
      lower: 0,
      upper: 1,
      alpha,
      method: 'one-sided-clopper-pearson',
    }
  return {
    successes,
    trials,
    estimate: successes / trials,
    lower: successes === 0 ? 0 : betaQuantile(alpha, successes, trials - successes + 1),
    upper: successes === trials ? 1 : betaQuantile(1 - alpha, successes + 1, trials - successes),
    alpha,
    method: 'one-sided-clopper-pearson',
  }
}
export const minimumZeroFailureTrials = (target = 0.01, alpha = 0.05) =>
  Math.ceil(Math.log(alpha) / Math.log1p(-target))
export function randomOf(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 4294967296
  }
}
export function clusterBootstrap(
  clusters,
  { seed = 20261111, replicates = 2000, alpha = 0.05 } = {},
) {
  invariant(Number.isSafeInteger(replicates) && replicates >= 100, 'Too few bootstrap replicates')
  if (clusters.length === 0)
    return {
      lower: 0,
      upper: 1,
      clusters: 0,
      method: 'topic-family-percentile-bootstrap-diagnostic',
    }
  const random = randomOf(seed)
  const values = []
  for (let r = 0; r < replicates; r++) {
    let numerator = 0
    let denominator = 0
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[Math.floor(random() * clusters.length)]
      numerator += cluster.numerator
      denominator += cluster.denominator
    }
    // No returns provides no precision evidence, rather than perfect precision.
    values.push(denominator === 0 ? 0 : numerator / denominator)
  }
  values.sort((a, b) => a - b)
  return {
    lower: values[Math.floor(alpha * (values.length - 1))],
    upper: values[Math.ceil((1 - alpha) * (values.length - 1))],
    clusters: clusters.length,
    seed,
    replicates,
    alpha,
    method: 'topic-family-percentile-bootstrap-diagnostic',
    limitation:
      'Small family counts and correlated synthetic authoring prevent an independent-trial guarantee. Degenerate all-zero/all-one bootstrap intervals are not evidence of certainty.',
  }
}
