/**
 * Query routing: which indexes a search should ask.
 *
 * The keyword tables below are **phrase-level**, not word-level. The earlier
 * version matched bare `graph`, `vision`, `attention`, `cell`, and `drug`,
 * which sent "attention economy", "vision of the firm", and "graph of social
 * relations" to arXiv and DBLP — a routing decision no configuration could
 * override, made on a word that is ordinary English everywhere else.
 *
 * The rule: a term enters these tables only when it is a domain phrase that
 * does not read as general language, and `attention` qualifies only with its
 * technical neighbor. Anything genuinely ambiguous falls through to the broad
 * default, which asks the general indexes instead of guessing.
 *
 * @module dsh-zotero/scholarly/router
 */

import { SCHOLARLY_SOURCE_IDS, type ScholarlySourceId } from './types.js'

/**
 * Terms that identify computing, mathematics, or physics literature.
 *
 * Built once with word boundaries and case-insensitivity. Multi-word phrases
 * are the point: `self-attention`, `graph neural`, and `vision transformer` are
 * technical; `attention`, `graph`, and `vision` alone are not.
 */
const CS_MATH_PHYSICS_REGEX = new RegExp(
  '\\b(?:' +
    [
      'transformers?',
      'llms?',
      'large language models?',
      'diffusion models?',
      'deep learning',
      'machine learning',
      'neural networks?',
      'self-attention',
      'attention mechanisms?',
      'graph neural',
      'graph learning',
      'compilers?',
      'gpus?',
      'cpus?',
      'algorithms?',
      'datasets?',
      'quantum',
      'theorems?',
      'automata',
      'nlp',
      'computer vision',
      'vision transformers?',
      'reinforcement learning',
      'stochastic gradient',
      'pre-?training',
      'fine-?tuning',
      'cs\\.[a-z]+',
      'stat\\.[a-z]+',
      'math\\.[a-z]+',
      'physics\\.[a-z]+',
    ].join('|') +
    ')\\b',
  'i',
)

/** Terms that identify biomedical or clinical literature. */
const BIOMEDICAL_REGEX = new RegExp(
  '\\b(?:' +
    [
      'genes?',
      'genomes?',
      'proteins?',
      'crispr',
      'clinical trials?',
      'cancer',
      'tumou?rs?',
      'cells?',
      'diseases?',
      'rna',
      'dna',
      'molecular',
      'mutations?',
      'drugs?',
      'viruses?',
      'viral',
      'patients?',
      'antibod(?:y|ies)',
      'pathology',
      'neurons?',
      'medical',
      'medicine',
      'hospitals?',
      'therap(?:y|ies)',
    ].join('|') +
    ')\\b',
  'i',
)

/** The general-coverage set a query falls back to when no domain is clear. */
const GENERAL_SOURCES: readonly ScholarlySourceId[] = [
  'arxiv',
  'openalex',
  'crossref',
  'semanticscholar',
]

/**
 * Determines which scholarly sources to search.
 * @param query - the user's query text.
 * @param explicitSources - a caller's explicit list, which wins when non-empty.
 * @returns the source ids to ask, never empty.
 */
export function routeQuery(
  query: string,
  explicitSources?: readonly string[],
): ScholarlySourceId[] {
  if (explicitSources !== undefined && explicitSources.length > 0) {
    const valid = explicitSources.filter((source): source is ScholarlySourceId =>
      (SCHOLARLY_SOURCE_IDS as readonly string[]).includes(source),
    )
    if (valid.length > 0) return [...new Set(valid)]
  }

  const isComputing = CS_MATH_PHYSICS_REGEX.test(query)
  const isBiomedical = BIOMEDICAL_REGEX.test(query)

  if (isComputing && !isBiomedical) {
    return ['arxiv', 'dblp', 'semanticscholar', 'openalex']
  }

  if (isBiomedical && !isComputing) {
    return ['pubmed', 'europepmc', 'crossref', 'openalex']
  }

  return [...GENERAL_SOURCES]
}
