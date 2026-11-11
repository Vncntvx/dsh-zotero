// Frozen-candidate offline heldout evaluation. No model/runtime imports.
// --freeze must equal the candidateDigest recorded BEFORE heldout encoding.
// This acknowledgement binds bytes, but cannot prove chronological independence.
import {
  cli,
  digestOf,
  invariant,
  isMain,
  loadDataset,
  options,
  pairRows,
  print,
  readJson,
  validateDataset,
} from './dataset.mjs'
import { featureRows, loadEmbeddings } from './features.mjs'
import { admissionSummary, perIntentOutcomes, regressionMetrics, scoreRows } from './metrics.mjs'

export function validateFrozenCandidate(candidate, dataset, freeze) {
  const { candidateDigest, ...content } = candidate
  invariant(
    typeof freeze === 'string' &&
      freeze === candidateDigest &&
      digestOf(content) === candidateDigest,
    'Candidate digest is not the acknowledged frozen digest',
  )
  invariant(
    candidate.kind === 'offline-calibration-candidate-not-runtime-artifact',
    'Unsupported candidate format',
  )
  invariant(
    candidate.datasetDigest === dataset.digest &&
      candidate.backgroundDigest === dataset.backgroundDigest &&
      candidate.protocolDigest === digestOf(dataset.manifest.protocol),
    'Candidate data/protocol changed after freeze',
  )
  invariant(
    candidate.threshold !== null &&
      Number.isFinite(candidate.threshold) &&
      candidate.threshold >= 0 &&
      candidate.threshold <= 1,
    'No calibrated threshold; heldout evaluation is forbidden',
  )
  invariant(
    dataset.manifest.protocol.thresholdCandidates.includes(candidate.threshold),
    'Threshold was not predeclared',
  )
  invariant(
    candidate.thresholdSelection?.selected === candidate.threshold &&
      candidate.thresholdSelection.candidates.some(
        (entry) => entry.threshold === candidate.threshold && entry.feasible,
      ),
    'No calibration support for the frozen threshold',
  )
  invariant(
    candidate.embeddingProvenance?.synthetic === false,
    'Synthetic vectors cannot authorize heldout model evaluation',
  )
  invariant(dataset.manifest.protocol.kCandidates.includes(candidate.k), 'Unknown frozen bank k')
  const model = candidate.classifier
  invariant(
    model?.converged === true &&
      model.coefficients?.length === 6 &&
      model.means?.length === 5 &&
      model.scales?.length === 5,
    'Invalid classifier dimensions',
  )
  invariant(
    [...model.coefficients, ...model.means, ...model.scales].every(Number.isFinite) &&
      model.scales.every((x) => x > 0),
    'Nonfinite/invalid classifier',
  )
}
if (isMain(import.meta.url))
  cli(async () => {
    const args = options(process.argv.slice(2), [
      '--candidate',
      '--embeddings',
      '--freeze',
      '--help',
    ])
    if (args['--help']) {
      process.stdout.write(
        'Usage: node scripts/semantic-calibration/evaluate.mjs --candidate /absolute/candidate.json --freeze SHA256 --embeddings /absolute/heldout-vectors.json\nFreeze and record the candidate before heldout encoding. Reads heldout only after a supported frozen threshold; stdout is a diagnostic report, never a WP6 completion claim.\n',
      )
      return
    }
    invariant(
      args['--candidate'] && args['--embeddings'] && args['--freeze'],
      'Candidate, frozen digest and heldout vectors are all required',
    )
    const dataset = await loadDataset()
    validateDataset(dataset)
    const candidate = await readJson(args['--candidate'])
    validateFrozenCandidate(candidate, dataset, args['--freeze'])
    const embeddings = await loadEmbeddings(args['--embeddings'], dataset, ['heldout'])
    invariant(
      !embeddings.synthetic && digestOf(embeddings.identity) === digestOf(candidate.model),
      'Heldout model differs from the frozen calibration model',
    )
    const rows = scoreRows(
      featureRows(dataset, pairRows(dataset, 'heldout'), embeddings, candidate.k),
      candidate.classifier,
    )
    const protocol = dataset.manifest.protocol
    const summary = admissionSummary(rows, candidate.threshold, protocol)
    print({
      schemaVersion: 1,
      kind: 'synthetic-heldout-offline-diagnostic',
      frozenCandidateDigest: candidate.candidateDigest,
      datasetDigest: dataset.digest,
      embeddingInputSha256: embeddings.inputSha256,
      provenance: dataset.manifest.provenance,
      model: embeddings.identity,
      summary,
      semanticRecall: regressionMetrics(rows, candidate.threshold),
      outcomes: perIntentOutcomes(rows, candidate.threshold),
      numericBudgetsMet: protocol.languages.every((language) => {
        const metrics = summary.perLanguage[language]
        return (
          metrics.rawNegativeCountSufficient &&
          metrics.negativeAnyHit.upper <= protocol.negativeAnyHitUpperTarget &&
          metrics.mixedReturnedPrecision.lower >= protocol.mixedPrecisionLowerTarget
        )
      }),
      wp6Acceptance: false,
      blockers: dataset.manifest.limitations.filter(
        (text) => !text.startsWith('No model was loaded'),
      ),
      freezeLimitation:
        'Explicit digest acknowledgement cannot prove that heldout was untouched before freeze. External run records and independently authored labels are still required.',
    })
    // This preparation corpus cannot produce a release/acceptance pass, even if
    // exploratory numerical metrics happen to be high.
    invariant(
      false,
      'Synthetic preparation diagnostics do not meet WP6 independent acceptance requirements',
    )
  })
