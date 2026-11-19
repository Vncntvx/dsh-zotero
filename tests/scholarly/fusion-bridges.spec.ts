import { expect, it } from 'vitest'
import { bestIdentifierOf, fuseRankedLists } from '../../src/scholarly/fusion.js'
import type { ScholarlyPaper } from '../../src/scholarly/types.js'

const record = (title: string, ids: Partial<ScholarlyPaper> = {}): ScholarlyPaper => ({
  title,
  authors: [],
  sources: [],
  ...ids,
})
const doi = '10.1000/formal'
const pmid = '12345678'
const arxiv = '2301.07041'
const pmcid = 'PMC12345'
const lists = [
  { sourceId: 'openalex', papers: [record('Formal publication', { doi })] },
  { sourceId: 'pubmed', papers: [record('Biomedical entry', { pmid })] },
  { sourceId: 'crossref', papers: [record('DOI and PMID bridge', { doi, pmid })] },
  { sourceId: 'arxiv', papers: [record('Preprint record', { arxiv, retracted: true })] },
  { sourceId: 'europepmc', papers: [record('Repository record', { pmcid })] },
  { sourceId: 'semanticscholar', papers: [record('PMID and preprint bridge', { pmid, arxiv })] },
  { sourceId: 'pmc-bridge', papers: [record('Preprint and PMCID bridge', { arxiv, pmcid })] },
]

it.each(
  [
    lists,
    [...lists].reverse(),
    [lists[4]!, lists[3]!, ...lists.slice(0, 3), ...lists.slice(5)],
  ].map((ordered) => ({ ordered })),
)('closes multi-source bridges independently of source order', ({ ordered }) => {
  const [entry, ...duplicates] = fuseRankedLists(ordered)
  expect(duplicates).toEqual([])
  expect(entry?.doi).toBe(doi)
  expect(entry?.retracted).not.toBe(true)
  expect(entry?.versions).toEqual(
    expect.arrayContaining([expect.objectContaining({ arxiv, retracted: true })]),
  )
  expect(entry?.sources).toHaveLength(lists.length)
})

it('counts each ranked input exactly once even when a bridge matches multiple keys', () => {
  const rivals = [
    { sourceId: 'above', weight: 3.01, papers: [record('Higher scoring independent work')] },
    { sourceId: 'below', weight: 2.99, papers: [record('Lower scoring independent work')] },
  ]
  expect(fuseRankedLists([...lists.slice(0, 3), ...rivals]).map(({ title }) => title)).toEqual([
    'Higher scoring independent work',
    'Formal publication',
    'Lower scoring independent work',
  ])
})

it('prioritizes the published DOI over a linked arXiv preprint', () => {
  expect(bestIdentifierOf(record('Published', { doi, arxiv }))).toBe(doi)
  expect(bestIdentifierOf(record('Preprint', { doi: `10.48550/arXiv.${arxiv}`, arxiv }))).toBe(
    `arXiv:${arxiv}`,
  )
})

it.each([false, true])(
  'keeps a distinct work reachable after conflicting bridges (reverse=%s)',
  (reverse) => {
    const other = '10.1000/other'
    const bridged = [
      { sourceId: 'openalex', papers: [record('First work', { doi })] },
      { sourceId: 'crossref', papers: [record('Other work', { doi: other, arxiv })] },
      { sourceId: 'pubmed', papers: [record('Bridge record', { doi, arxiv })] },
    ]
    if (reverse) [bridged[0], bridged[1]] = [bridged[1]!, bridged[0]!]
    const fused = fuseRankedLists([
      ...bridged,
      { sourceId: 'repeat-bridge', papers: [record('Bridge reindex', { doi, arxiv })] },
      { sourceId: 'repeat-other', papers: [record('Other work reindex', { doi: other, arxiv })] },
    ])
    expect(fused).toHaveLength(2)
    expect(fused.map(({ title }) => title).sort()).toEqual(['First work', 'Other work'])
    expect(fused.find(({ title }) => title === 'First work')?.versions).toBeUndefined()
    expect(fused.find(({ doi }) => doi === other)?.sources).toContain('repeat-other')
  },
)

it('stands a late paper alone when its only index key is stale on the entry', () => {
  const stale = '10.1000/stale'
  const decayed = [
    { sourceId: 'openalex', papers: [record('Primary work', { doi, arxiv })] },
    { sourceId: 'crossref', papers: [record('Version record', { doi: stale, arxiv })] },
    { sourceId: 'pubmed', papers: [record('Stale-key work', { doi: stale })] },
  ]
  const fused = fuseRankedLists(decayed)
  expect(fused).toHaveLength(2)
  expect(fused[0]?.doi).toBe(doi)
  expect(fused[0]?.versions).toEqual([expect.objectContaining({ doi: stale })])
  expect(fused[1]?.title).toBe('Stale-key work')
})

it('continues past a conflicting stale key to another compatible candidate', () => {
  const stale = '10.1000/stale'
  const fused = fuseRankedLists([
    { sourceId: 'primary', papers: [record('Primary work', { doi, arxiv })] },
    { sourceId: 'version', papers: [record('Version record', { doi: stale, arxiv })] },
    { sourceId: 'pmid', papers: [record('Biomedical entry', { pmid })] },
    { sourceId: 'bridge', papers: [record('PMID and DOI bridge', { doi: stale, pmid })] },
  ])
  expect(fused).toHaveLength(2)
  expect(fused.find(({ doi }) => doi === stale)?.sources).toEqual(['bridge', 'pmid'])
})
