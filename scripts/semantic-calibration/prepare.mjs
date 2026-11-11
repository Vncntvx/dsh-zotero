// Export encoding inputs or deterministic corpus stress requests to stdout.
// No output path is opened; callers choose where to redirect stdout.
import { SEMANTIC_MODELS } from '../semantic-model-catalog.mjs'
import {
  backgroundEntries,
  cli,
  digestOf,
  invariant,
  isMain,
  loadDataset,
  options,
  print,
  readJson,
  splitEntries,
  textKey,
  validateDataset,
} from './dataset.mjs'
import { modelIdentity } from './features.mjs'
import { validateFrozenCandidate } from './evaluate.mjs'

export function corpusRequests(dataset, split, maximum) {
  const families = dataset.partitions[split].families
  const sizes = [
    ...new Set([...dataset.manifest.protocol.corpusSizes, ...(maximum ? [maximum] : [])]),
  ].sort((a, b) => a - b)
  const requests = []
  for (const family of families)
    for (const query of family.queries)
      for (const language of ['en', 'zh'])
        for (const documentLanguage of ['en', 'zh']) {
          const own = family.documents.map((document) => ({
            familyId: family.id,
            id: document.id,
            text: document.text[documentLanguage],
            relevant: query.relevant.includes(document.id),
          }))
          const other = families
            .filter((candidate) => candidate !== family)
            .flatMap((owner) =>
              owner.documents.map((document) => ({
                familyId: owner.id,
                id: document.id,
                text: document.text[documentLanguage],
                relevant: false,
              })),
            )
          const phrasings = [query.text[language], ...(query.variants?.[language] ?? [])]
          for (const mode of ['mixed', 'negative-only']) {
            const pool =
              mode === 'mixed' ? own : [...own.filter((document) => !document.relevant), ...other]
            invariant(pool.length > 0, 'Empty stress pool')
            // Positive intents are also tested with their answers removed, but these
            // removals do not create extra independent queries or validation labels.
            for (const size of sizes)
              for (const phrasingCount of dataset.manifest.protocol.phrasingCounts) {
                if (phrasingCount > phrasings.length) continue
                const ordered =
                  mode === 'mixed'
                    ? [
                        ...own.filter((d) => d.relevant),
                        ...own.filter((d) => !d.relevant),
                        ...other,
                      ]
                    : pool
                const chunks = Array.from({ length: size }, (_, index) => {
                  const doc = ordered[index % ordered.length]
                  return {
                    index: index * 3 - 7,
                    textKey: textKey('document', doc.text),
                    sourceHandle: `${split}/${doc.familyId}/${doc.id}/${index}`,
                    relevant: doc.relevant,
                  }
                })
                requests.push({
                  id: `${split}/${family.id}/${query.id}/${language}-${documentLanguage}/${mode}/${size}/${phrasingCount}`,
                  intentId: `${family.id}/${query.id}`,
                  familyId: family.id,
                  language,
                  documentLanguage,
                  mode,
                  size,
                  phrasingCount,
                  independentQueryUnit: `${language}/${family.id}/${query.id}`,
                  queryKeys: phrasings
                    .slice(0, phrasingCount)
                    .map((text) => textKey('query', text)),
                  chunks,
                  uniqueDocumentTexts: new Set(chunks.map((chunk) => chunk.textKey)).size,
                  duplicatesAreStressOnly: true,
                  productionChunkingVerified: false,
                  allRelevantCovered: query.relevant.every((id) =>
                    chunks.some((chunk) => chunk.sourceHandle.includes(`/${family.id}/${id}/`)),
                  ),
                })
              }
          }
        }
  return requests
}
if (isMain(import.meta.url))
  cli(async () => {
    const args = options(process.argv.slice(2), [
      '--mode',
      '--split',
      '--max-corpus',
      '--candidate',
      '--freeze',
      '--help',
    ])
    if (args['--help']) {
      process.stdout.write(
        'Usage: node scripts/semantic-calibration/prepare.mjs --mode encoding|corpora --split fit|heldout [--max-corpus INTEGER] [--candidate PATH --freeze SHA256]\nfit exports only train+calibration and fixed banks; heldout export requires a supported frozen candidate before any encoding.\nEncoding export contains inputs and required model identity, never vectors or a fitted artifact.\n',
      )
      return
    }
    invariant(
      ['encoding', 'corpora'].includes(args['--mode']),
      'Specify --mode encoding or corpora',
    )
    invariant(['fit', 'heldout'].includes(args['--split']), 'Specify --split fit or heldout')
    const selected = args['--split'] === 'fit' ? ['train', 'calibration'] : ['heldout']
    const maximum = args['--max-corpus'] === undefined ? undefined : Number(args['--max-corpus'])
    invariant(
      maximum === undefined || (Number.isSafeInteger(maximum) && maximum >= 64 && maximum <= 16384),
      '--max-corpus must be the explicit production bound, between 64 and 16384',
    )
    const dataset = await loadDataset()
    const counts = validateDataset(dataset)
    if (selected.includes('heldout')) {
      invariant(
        args['--candidate'] && args['--freeze'],
        'Heldout export requires a supported frozen candidate and --freeze digest',
      )
      validateFrozenCandidate(await readJson(args['--candidate']), dataset, args['--freeze'])
    }
    const entries = [
      ...backgroundEntries(dataset),
      ...selected.flatMap((split) => splitEntries(dataset, split)),
    ]
    const common = {
      schemaVersion: 1,
      synthetic: true,
      role: 'input-preparation-only',
      datasetDigest: dataset.digest,
      backgroundDigest: dataset.backgroundDigest,
      partitionDigests: Object.fromEntries(
        selected.map((split) => [split, dataset.partitionDigests[split]]),
      ),
      provenance: dataset.manifest.provenance,
      counts: Object.fromEntries(selected.map((split) => [split, counts[split]])),
    }
    if (args['--mode'] === 'encoding')
      print({
        ...common,
        entries,
        requiredEmbeddingFormat: {
          schemaVersion: 1,
          synthetic: false,
          generatedBy: 'identify actual encoder and version',
          model: 'use exactly one requiredModelIdentities entry',
          entries: 'one {key, vector} per input entry; no other split vectors',
        },
        requiredModelIdentities: SEMANTIC_MODELS.map(modelIdentity),
        inputDigest: digestOf(entries),
      })
    else
      print({
        ...common,
        corpusRequests: selected.flatMap((split) => corpusRequests(dataset, split, maximum)),
        configuredMaximumIncluded: maximum ?? null,
        limitation:
          'Source duplicates only exercise index/size stress; these authored passages do not establish production chunking or real extraction behavior.',
      })
  })
