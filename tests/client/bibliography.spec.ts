/**
 * Bibliography predicates: the path-only arm stays on strict extensions, while
 * the deliverable arm may use the model's description for generic JSON.
 * @module tests/client/bibliography
 */

import { describe, expect, it } from 'vitest'
import { isBibliographyDeliverable, isBibliographyPath } from '../../src/client/bibliography.ts'

describe('isBibliographyPath', () => {
  it.each([
    'refs.bib',
    'refs.ris',
    'refs.csljson',
    'refs.csl.json',
    'refs.biblatex',
    'refs.bibtex',
  ])('accepts the strict bibliography extension %s', (path) => {
    expect(isBibliographyPath(path)).toBe(true)
  })

  it.each(['references.json', 'package.json', 'paper.pdf', 'notes.md', '', undefined])(
    'declines the path-only form %s',
    (path) => {
      expect(isBibliographyPath(path)).toBe(false)
    },
  )
})

describe('isBibliographyDeliverable', () => {
  it('accepts strict extensions unconditionally', () => {
    expect(isBibliographyDeliverable({ path: '/workspace/papers.bib' })).toBe(true)
    expect(isBibliographyDeliverable({ path: '/workspace/papers.ris' })).toBe(true)
  })

  it('accepts a generic JSON file only with a bibliography description or name', () => {
    expect(isBibliographyDeliverable({ path: 'package.json' })).toBe(false)
    expect(
      isBibliographyDeliverable({ path: 'export.json', description: 'exported CSL JSON' }),
    ).toBe(true)
    expect(isBibliographyDeliverable({ path: 'references.json' })).toBe(true)
  })

  it('declines missing metadata', () => {
    expect(isBibliographyDeliverable(undefined)).toBe(false)
    expect(isBibliographyDeliverable({ path: '' })).toBe(false)
  })
})
