// node scripts/semantic-calibration/fit.mjs --embeddings /absolute/fit-vectors.json
// Deterministic offline preparation only; JSON stdout is never a runtime artifact.
import {
  cli,
  digestOf,
  invariant,
  isMain,
  loadDataset,
  options,
  pairRows,
  print,
  validateDataset,
} from './dataset.mjs'
import { featureRows, loadEmbeddings } from './features.mjs'
import { fitLogistic, groupedSelect } from './logistic.mjs'
import { perIntentOutcomes, regressionMetrics, scoreRows, selectThreshold } from './metrics.mjs'

export async function fitCandidate(dataset, embeddings) {
  validateDataset(dataset)
  const protocol = dataset.manifest.protocol
  const train = pairRows(dataset, 'train')
  const rowsByK = new Map(
    protocol.kCandidates.map((k) => [k, featureRows(dataset, train, embeddings, k)]),
  )
  const selection = groupedSelect(rowsByK, protocol)
  const { k, lambda } = selection.selected
  const classifier = fitLogistic(rowsByK.get(k), lambda)
  const calibration = scoreRows(
    featureRows(dataset, pairRows(dataset, 'calibration'), embeddings, k),
    classifier,
  )
  const thresholdSelection = selectThreshold(calibration, protocol)
  const threshold = thresholdSelection.selected
  const candidate = {
    schemaVersion: 1,
    kind: 'offline-calibration-candidate-not-runtime-artifact',
    scoringVersion: protocol.scoringVersion,
    featureNames: protocol.features,
    model: embeddings.identity,
    embeddingInputSha256: embeddings.inputSha256,
    embeddingProvenance: { synthetic: embeddings.synthetic, generatedBy: embeddings.generatedBy },
    dataProvenance: dataset.manifest.provenance,
    datasetDigest: dataset.digest,
    backgroundDigest: dataset.backgroundDigest,
    partitionDigests: dataset.partitionDigests,
    protocolDigest: digestOf(protocol),
    k,
    classifier,
    threshold,
    selection,
    thresholdSelection,
    trainingRows: train.length,
    calibrationRows: calibration.length,
    calibrationOutcomes: threshold === null ? null : perIntentOutcomes(calibration, threshold),
    calibrationRecall: threshold === null ? null : regressionMetrics(calibration, threshold),
    status:
      threshold === null ? 'failed-calibration-budget-or-support' : 'experimental-candidate-only',
    productionEligible: false,
    wp6Acceptance: false,
    blockers: [
      ...dataset.manifest.limitations.filter((text) => !text.startsWith('No model was loaded')),
      'This script fits only supplied vectors; it does not run production ranker/chunking, original 24-case hybrid regression or six-model runtime acceptance.',
      ...(embeddings.synthetic
        ? ['Synthetic self-check vectors are not real model evidence.']
        : []),
      ...(threshold === null
        ? [
            'No predeclared threshold meets independent calibration support and error budgets. A reject-all threshold is not substituted.',
          ]
        : []),
    ],
  }
  return { ...candidate, candidateDigest: digestOf(candidate) }
}
if (isMain(import.meta.url))
  cli(async () => {
    const args = options(process.argv.slice(2), ['--embeddings', '--help'])
    if (args['--help']) {
      process.stdout.write(
        'Usage: node scripts/semantic-calibration/fit.mjs --embeddings /absolute/fit-vectors.json\nReads only supplied vectors. No model download/loading or file writes. Reports actual fit to stdout; exits nonzero if calibration support/budget is insufficient.\n',
      )
      return
    }
    invariant(
      args['--embeddings'],
      'Missing --embeddings; this command cannot create or download vectors',
    )
    const dataset = await loadDataset()
    const embeddings = await loadEmbeddings(args['--embeddings'], dataset, ['train', 'calibration'])
    const candidate = await fitCandidate(dataset, embeddings)
    print(candidate)
    invariant(
      candidate.threshold !== null,
      'Calibration failed; no threshold/artifact may be integrated',
    )
    invariant(!embeddings.synthetic, 'Self-check vectors cannot produce model calibration evidence')
  })
