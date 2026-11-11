// Pure offline fixture loading and expansion. No runtime, encoder or network imports.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const fixtureRoot = fileURLToPath(
  new URL('../../tests/fixtures/semantic-calibration/', import.meta.url),
)
export const splits = ['train', 'calibration', 'heldout']
export const languages = ['en', 'zh']
export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const normalized = (text) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]+/gu, '')
export const invariant = (condition, message) => {
  if (!condition) throw new Error(message)
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
export const digestOf = (value) => sha256(canonical(value))
export const textKey = (side, text) => `${side}:${sha256(text)}`
export const codepoints = (text) => [...text].length

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}
export function options(argv, allowed) {
  const result = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    invariant(allowed.includes(key), `Unknown argument: ${key}`)
    invariant(result[key] === undefined, `Repeated argument: ${key}`)
    if (key === '--require-ready' || key === '--help') result[key] = true
    else {
      invariant(argv[i + 1] && !argv[i + 1].startsWith('--'), `Missing value for ${key}`)
      result[key] = argv[++i]
    }
  }
  return result
}
export const isMain = (url) =>
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url
export function cli(main) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
export const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

export async function loadDataset() {
  const manifest = await readJson(resolve(fixtureRoot, 'manifest.json'))
  const background = await readJson(resolve(fixtureRoot, manifest.background))
  const quarantine = await readJson(resolve(fixtureRoot, manifest.quarantine))
  const partitions = Object.fromEntries(
    await Promise.all(
      splits.map(async (split) => [
        split,
        await readJson(resolve(fixtureRoot, manifest.partitions[split])),
      ]),
    ),
  )
  const dataset = { manifest, background, quarantine, partitions }
  dataset.digest = digestOf({ manifest, background, quarantine, partitions })
  dataset.backgroundDigest = digestOf(background)
  dataset.partitionDigests = Object.fromEntries(
    splits.map((split) => [split, digestOf(partitions[split])]),
  )
  return dataset
}

function bilingual(text, where) {
  invariant(text && Object.keys(text).sort().join(',') === 'en,zh', `${where}: expected en/zh`)
  for (const language of languages) {
    invariant(
      typeof text[language] === 'string' && text[language].trim().length >= 12,
      `${where}: empty/short ${language}`,
    )
    invariant(!/[\u0000-\u0008\u000b-\u001f]/u.test(text[language]), `${where}: control byte`)
    invariant(!/\b(?:TODO|TBD|lorem ipsum)\b/iu.test(text[language]), `${where}: placeholder`)
  }
}

export function validateDataset(dataset) {
  const { manifest, background, quarantine, partitions } = dataset
  invariant(
    manifest.schemaVersion === 1 && manifest.provenance.synthetic === true,
    'Missing synthetic provenance',
  )
  invariant(
    manifest.provenance.externalIndependentAnnotation === false &&
      manifest.provenance.realExtraction === false,
    'Unsupported provenance claim',
  )
  invariant(quarantine.legacyCases.length === 24, 'Expected 24 quarantined regression cases')
  const blocked = new Set(
    [
      ...quarantine.legacyCases.flatMap((row) => [row.query, row.answer]),
      ...quarantine.distractors,
      ...quarantine.diagnosticProbes,
    ].map(normalized),
  )
  const familyIds = new Set()
  const topics = new Set()
  const documentFamilies = new Set()
  const texts = new Map()
  const registerText = (text, owner) => {
    const key = normalized(text)
    invariant(!blocked.has(key), `${owner}: quarantined text reused`)
    invariant(!texts.has(key), `${owner}: duplicate text with ${texts.get(key)}`)
    texts.set(key, owner)
  }
  const registerFamily = (family) => {
    for (const [set, value, label] of [
      [familyIds, family.id, 'family'],
      [topics, family.topic, 'topic'],
      [documentFamilies, family.documentFamily, 'document family'],
    ]) {
      invariant(
        typeof value === 'string' && value.length > 2 && !set.has(normalized(value)),
        `Repeated/missing ${label}: ${value}`,
      )
      set.add(normalized(value))
    }
  }
  for (const family of background.families) {
    registerFamily(family)
    for (const side of ['query', 'document']) {
      bilingual(family[side], `${family.id}/${side}`)
      for (const language of languages)
        registerText(family[side][language], `${family.id}/${side}/${language}`)
    }
  }
  const counts = {}
  for (const split of splits) {
    invariant(
      partitions[split].split === split && partitions[split].schemaVersion === 1,
      `Partition mismatch: ${split}`,
    )
    const families = partitions[split].families
    counts[split] = { families: families.length, perLanguage: {}, formats: {}, negativeKinds: {} }
    for (const language of languages)
      counts[split].perLanguage[language] = {
        positiveIntents: 0,
        negativeIntents: 0,
        documents: 0,
        fivePhrasingIntents: 0,
      }
    for (const family of families) {
      registerFamily(family)
      const docIds = new Set()
      const queryIds = new Set()
      invariant(
        family.documents.length >= 2 && family.queries.length >= 2,
        `${family.id}: empty family`,
      )
      for (const document of family.documents) {
        invariant(!docIds.has(document.id), `${family.id}: duplicate document ID`)
        docIds.add(document.id)
        invariant(
          ['prose', 'table', 'formula', 'markdown', 'simulated-extraction'].includes(
            document.format,
          ),
          `${family.id}: unknown format`,
        )
        counts[split].formats[document.format] = (counts[split].formats[document.format] ?? 0) + 1
        bilingual(document.text, `${family.id}/${document.id}`)
        for (const language of languages) {
          registerText(document.text[language], `${family.id}/${document.id}/${language}`)
          counts[split].perLanguage[language].documents++
        }
      }
      for (const query of family.queries) {
        invariant(!queryIds.has(query.id), `${family.id}: duplicate query ID`)
        queryIds.add(query.id)
        invariant(
          Array.isArray(query.relevant) && new Set(query.relevant).size === query.relevant.length,
          `${family.id}/${query.id}: invalid labels`,
        )
        invariant(
          query.relevant.every((id) => docIds.has(id)),
          `${family.id}/${query.id}: missing relevant doc`,
        )
        invariant(
          typeof query.rationale === 'string' && query.rationale.length > 15,
          `${family.id}/${query.id}: missing label rationale`,
        )
        bilingual(query.text, `${family.id}/${query.id}`)
        if (query.relevant.length === 0)
          counts[split].negativeKinds[query.kind] =
            (counts[split].negativeKinds[query.kind] ?? 0) + 1
        for (const language of languages) {
          registerText(query.text[language], `${family.id}/${query.id}/${language}`)
          const variants = query.variants?.[language] ?? []
          invariant(variants.length <= 4, `${family.id}/${query.id}: more than five phrasings`)
          for (const variant of variants) {
            invariant(
              typeof variant === 'string' && variant.trim().length >= 12,
              `${family.id}/${query.id}: invalid variant`,
            )
            registerText(variant, `${family.id}/${query.id}/${language}/variant`)
          }
          const count = counts[split].perLanguage[language]
          count[query.relevant.length ? 'positiveIntents' : 'negativeIntents']++
          if (variants.length === 4) count.fivePhrasingIntents++
        }
      }
    }
  }
  return counts
}

export function backgroundEntries(dataset) {
  return dataset.background.families.flatMap((family) =>
    languages.flatMap((language) =>
      ['query', 'document'].map((side) => ({
        key: textKey(side, family[side][language]),
        side,
        text: family[side][language],
        language,
        familyId: family.id,
        role: 'background',
      })),
    ),
  )
}
export function splitEntries(dataset, split) {
  return dataset.partitions[split].families.flatMap((family) => [
    ...family.documents.flatMap((document) =>
      languages.map((language) => ({
        key: textKey('document', document.text[language]),
        side: 'document',
        text: document.text[language],
        language,
        familyId: family.id,
        documentId: document.id,
        role: split,
      })),
    ),
    ...family.queries.flatMap((query) =>
      languages.flatMap((language) =>
        [query.text[language], ...(query.variants?.[language] ?? [])].map((text, phrasing) => ({
          key: textKey('query', text),
          side: 'query',
          text,
          language,
          familyId: family.id,
          intentId: `${family.id}/${query.id}`,
          phrasing,
          role: split,
        })),
      ),
    ),
  ])
}

// Every cross-family pair below is an authored off-topic negative assumption;
// semantic label validity still needs independent review. No cross-split documents.
export function pairRows(dataset, split) {
  const families = dataset.partitions[split].families
  const rows = []
  for (let f = 0; f < families.length; f++) {
    const family = families[f]
    for (const query of family.queries)
      for (const language of languages) {
        const phrasings = [query.text[language], ...(query.variants?.[language] ?? [])]
        phrasings.forEach((text, phrasing) => {
          for (const documentLanguage of languages)
            for (const owner of families)
              for (const document of owner.documents) {
                rows.push({
                  familyId: family.id,
                  documentFamilyId: owner.id,
                  intentId: `${family.id}/${query.id}`,
                  language,
                  documentLanguage,
                  phrasing,
                  queryKey: textKey('query', text),
                  documentKey: textKey('document', document.text[documentLanguage]),
                  queryText: text,
                  documentText: document.text[documentLanguage],
                  label: owner === family && query.relevant.includes(document.id) ? 1 : 0,
                  negativeIntent: query.relevant.length === 0,
                  kind: owner === family ? query.kind : 'off-topic',
                })
              }
        })
      }
  }
  return rows
}
