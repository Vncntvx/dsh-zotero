/**
 * Fold parity between the ranking seam's lexical route and Zotero's own
 * search normalization.
 *
 * `src/search-text.ts` mirrors `Zotero.Utilities.Internal.normalizeForSearch`,
 * and it must stay the single fold: a search that found a paper by folding
 * `cafe` onto `café` has to be able to rank that paper's passages, or the same
 * query answers "this paper is relevant" and "nothing in it is". The ranking
 * seam sits on top of it, so these cases pin the seam, not the fold.
 *
 * The negative half matters as much as the positive half. The lexical route is
 * term overlap and nothing else: it does not stem, lemmatize, or expand. A test
 * that only asserted the folding cases would let a future change slip
 * morphological normalization into the shared fold — which is exactly what the
 * semantic route exists to do *beside* the fold, never inside it.
 * @module tests/local/retrieve/retrieve-normalization-parity
 */

import { describe, expect, it } from 'vitest'
import { chunkText, tokenize } from '../../../src/evidence.js'
import { bm25EvidenceRanker, queryTermsAcross } from '../../../src/local/evidence-ranker.js'
import { rankPassages } from '../../../src/scholarly/fulltext/evidence-bridge.js'
import { normalizeForSearch } from '../../../src/search-text.js'

/** A one-passage rank: the chunk indices the lexical route returns. */
async function matchedIndices(query: string, passages: readonly string[]): Promise<number[]> {
  const result = await bm25EvidenceRanker.rank({
    query,
    chunks: passages.map((text, index) => ({ text, index })),
  })
  return result.matches.map((entry) => entry.index)
}

describe('lexical route fold parity', () => {
  it('finds an accented form from an unaccented query', async () => {
    // The server-side case: Zotero searches `cafe` and returns the paper whose
    // metadata says `café`. The passage must then rank.
    const passages = ['a study of café culture', 'an unrelated passage about bridges']
    expect(await matchedIndices('cafe', passages)).toEqual([0])
  })

  it('finds a curly apostrophe from a straight one', async () => {
    const passages = ['children\u2019s reasoning about number', 'adult performance on the task']
    expect(await matchedIndices("children's", passages)).toEqual([0])
  })

  it('finds a typographic dash from a typed hyphen', async () => {
    const passages = ['a pre\u2013registration protocol', 'a post-hoc comparison']
    expect(await matchedIndices('pre-registration', passages)).toEqual([0])
  })

  it('folds the passage side and the query side the same way', () => {
    // Both sides go through the one fold; a second, different normalization on
    // either side is what would break the pair above.
    const text = 'Caf\u00e9 \u201cquoted\u201d \u2014 children\u2019s'
    expect(tokenize(text)).toEqual(tokenize(normalizeForSearch(text)))
    // The apostrophe is folded to ASCII and kept inside the word, exactly as
    // ICU segments a possessive; folding does not split it into two tokens.
    expect(tokenize(text)).toEqual(['cafe', 'quoted', "children's"])
  })

  it('reports the folded query terms, not the typed ones', () => {
    expect(queryTermsAcross('Caf\u00e9 children\u2019s')).toEqual(['cafe', "children's"])
  })

  it('returns passage text verbatim: the fold is an index, never a rewrite', async () => {
    // The chunker cuts on word spans, so the trailing punctuation is outside
    // the passage; what matters is that the characters inside it are the
    // source's own, not the folded forms the ranking matched on.
    const source = 'Fieldwork in a caf\u00e9: children\u2019s talk, pre\u2013registration'
    const { passages: ranked } = await rankPassages({
      ranker: bm25EvidenceRanker,
      text: source,
      query: 'cafe',
      limit: 1,
    })
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.text).toBe(source)
    expect(ranked[0]!.text).toContain('caf\u00e9')
    expect(ranked[0]!.text).toContain('\u2019')
    expect(ranked[0]!.text).toContain('\u2013')
    expect(chunkText(source, 180, 1_200)[0]!.text).toBe(source)
  })
})

describe('lexical route boundaries', () => {
  it('does not stem: a different word form is not a match', async () => {
    // `compliance` and `complied` share a stem and nothing else. BM25 here must
    // not bridge them: the fold is orthographic, and a morphological bridge is
    // the semantic route's job, where it is labelled as such.
    const passages = ['the regulator complied with the order', 'an unrelated passage']
    expect(await matchedIndices('compliance', passages)).toEqual([])
  })

  it('does not expand synonyms', async () => {
    const passages = ['perceived legitimacy drives regulatory adherence', 'an unrelated passage']
    expect(await matchedIndices('institutional trust', passages)).toEqual([])
  })

  it('scores on content terms only, so a function-word query matches nothing', async () => {
    const passages = ['the role of the state in the economy']
    expect(await matchedIndices('the of and in', passages)).toEqual([])
    expect(queryTermsAcross('the of and in')).toEqual([])
  })
})
