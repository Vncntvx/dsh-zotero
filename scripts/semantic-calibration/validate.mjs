// node scripts/semantic-calibration/validate.mjs [--require-ready]
// Writes JSON to stdout only. --require-ready fails for this preparation set.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  cli,
  fixtureRoot,
  invariant,
  isMain,
  loadDataset,
  options,
  print,
  sha256,
  splits,
  validateDataset,
} from './dataset.mjs'
import { binomialBounds, minimumZeroFailureTrials } from './statistics.mjs'

export async function dataReport() {
  const dataset = await loadDataset()
  const counts = validateDataset(dataset)
  const source = await readFile(
    resolve(fixtureRoot, '../../../', dataset.quarantine.legacySource),
    'utf8',
  )
  invariant(
    sha256(source) === dataset.quarantine.legacySourceSha256,
    'Legacy regression source changed: review the quarantine explicitly',
  )
  const p = dataset.manifest.protocol
  const negativeSupport = Object.fromEntries(
    splits.map((split) => [
      split,
      Object.fromEntries(
        p.languages.map((language) => {
          const n = counts[split].perLanguage[language].negativeIntents
          return [
            language,
            {
              uniqueAuthoredNegativeIntents: n,
              missingToRawCountTarget: Math.max(0, p.minimumNegativeQueriesPerLanguage - n),
              bestPossibleZeroFailureUpper95: binomialBounds(0, n).upper,
              satisfiesRawCountTarget: n >= p.minimumNegativeQueriesPerLanguage,
              establishesIndependentSampling: false,
            },
          ]
        }),
      ),
    ]),
  )
  return {
    schemaVersion: 1,
    datasetDigest: dataset.digest,
    counts,
    negativeSupport,
    quarantinedRegressionCases: dataset.quarantine.legacyCases.length,
    minimumZeroFailureIndependentTrialsForOnePercent: minimumZeroFailureTrials(),
    readyForWp6Acceptance: false,
    reasons: dataset.manifest.limitations,
    independence:
      'Translations share intents; variants/repeated sources/runs are not new queries. Topic families are split, but the same synthetic author is not an independent annotation process.',
    actualModelResults: null,
  }
}
if (isMain(import.meta.url))
  cli(async () => {
    const args = options(process.argv.slice(2), ['--require-ready', '--help'])
    if (args['--help']) {
      process.stdout.write(
        'Usage: node scripts/semantic-calibration/validate.mjs [--require-ready]\nNo network, inference or file writes. JSON report goes to stdout.\n',
      )
      return
    }
    const report = await dataReport()
    print(report)
    if (args['--require-ready'])
      invariant(
        report.readyForWp6Acceptance,
        'WP6 acceptance data are not ready; see the reported scale and provenance limitations',
      )
  })
