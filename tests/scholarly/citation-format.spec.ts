/**
 * Citation body validation.
 *
 * Every response is judged on two facts: does the body parse as the format the
 * caller requested, and does it name the DOI that was requested? A registry
 * that answers 200 with HTML, an empty body, broken JSON, or another work's
 * record is a failure, not a citation.
 *
 * @module tests/scholarly/citation-format
 */

import { describe, expect, it } from 'vitest'
import {
  normalizeDoiForCompare,
  validateBibtex,
  validateCitation,
  validateCslJson,
  validateFormattedText,
  validateRis,
} from '../../src/scholarly/citation-format.js'

const DOI = '10.1234/known.1'

describe('citation DOI comparison', () => {
  it('normalizes a doi.org URL and case', () => {
    expect(normalizeDoiForCompare('https://doi.org/10.1234/ABC.1')).toBe('10.1234/abc.1')
    expect(normalizeDoiForCompare('doi:10.1234/known.1.')).toBe('10.1234/known.1')
  })
})

describe('CSL-JSON validation', () => {
  it('accepts one record with a title and the requested DOI', () => {
    const body = JSON.stringify({ DOI: DOI, title: 'A Real Study' })
    expect(validateCslJson(body, DOI)).toMatchObject({
      ok: true,
      resolvedDoi: DOI,
      value: body,
    })
  })

  it('accepts a one-element array', () => {
    const body = JSON.stringify([{ doi: DOI, title: ['A Real Study'] }])
    expect(validateCslJson(body, DOI).ok).toBe(true)
  })

  it('rejects HTML, broken JSON, and a non-record body', () => {
    expect(validateCslJson('', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('empty body'),
    })
    expect(validateCslJson('<html><body>No</body></html>', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not valid JSON'),
    })
    expect(validateCslJson('{bad json', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not valid JSON'),
    })
    expect(validateCslJson('"just a string"', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not a CSL-JSON record'),
    })
  })

  it('rejects a non-string DOI field', () => {
    expect(validateCslJson(JSON.stringify({ DOI: 1234, title: 'T' }), DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no DOI'),
    })
  })

  it('rejects a record for another DOI', () => {
    const body = JSON.stringify({ DOI: '10.1234/other.1', title: 'Another Work' })
    expect(validateCslJson(body, DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not the requested'),
    })
  })

  it('rejects a record with no DOI or no title', () => {
    expect(validateCslJson(JSON.stringify({ title: 'No DOI' }), DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no DOI'),
    })
    expect(validateCslJson(JSON.stringify({ DOI }), DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no title'),
    })
  })

  it('rejects an array of more than one record', () => {
    const body = JSON.stringify([
      { DOI, title: 'One' },
      { DOI: '10.1234/second.1', title: 'Two' },
    ])
    expect(validateCslJson(body, DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('got 2'),
    })
  })
})

describe('BibTeX validation', () => {
  it('accepts a braced and a quoted DOI field', () => {
    expect(validateBibtex('@article{x, title={T}, DOI={10.1234/known.1}}', DOI).ok).toBe(true)
    expect(validateBibtex('@article{x,\n doi = "10.1234/known.1"\n}', DOI).ok).toBe(true)
  })

  it('rejects a body with no entry or unbalanced braces', () => {
    expect(validateBibtex('', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('empty body'),
    })
    expect(validateBibtex('<html></html>', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('markup'),
    })
    expect(validateBibtex('not a citation', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no BibTeX entry'),
    })
    expect(validateBibtex('@article-x, title={T}', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('does not start with a BibTeX entry'),
    })
    expect(validateBibtex('@article{x, title={T}', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('unbalanced braces'),
    })
    expect(validateBibtex('@article{x}}', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('unbalanced braces'),
    })
  })

  it('rejects an entry with no DOI field or another DOI', () => {
    expect(validateBibtex('@article{x, title={T}}', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no DOI field'),
    })
    expect(validateBibtex('@article{x, DOI={10.1234/other.1}}', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not the requested'),
    })
  })
})

describe('RIS validation', () => {
  it('accepts a TY/DO/ER record for the requested DOI', () => {
    const body = 'TY  - JOUR\nTI  - A Real Study\nDO  - 10.1234/known.1\nER  - '
    expect(validateRis(body, DOI)).toMatchObject({ ok: true, resolvedDoi: DOI })
  })

  it('rejects a missing TY, ER, or DO field', () => {
    expect(validateRis('', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('empty body'),
    })
    expect(validateRis('<html></html>', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('markup'),
    })
    expect(validateRis('DO  - 10.1234/known.1\nER  - ', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('TY field'),
    })
    expect(validateRis('TY  - JOUR\nDO  - 10.1234/known.1', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('ER terminator'),
    })
    expect(validateRis('TY  - JOUR\nTI  - A Real Study\nER  - ', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no DO field'),
    })
  })

  it('rejects a record for another DOI', () => {
    expect(validateRis('TY  - JOUR\nDO  - 10.1234/other.1\nER  - ', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not the requested'),
    })
  })
})

describe('formatted text validation', () => {
  it('accepts prose of a plausible length', () => {
    const body = 'Doe, J. (2015). A Real Study. Journal of Examples, 1(2), 3-4.'
    expect(validateFormattedText(body, DOI)).toMatchObject({ ok: true, value: body })
  })

  it('rejects an empty body, HTML, a short string, and an error page', () => {
    expect(validateFormattedText('   ', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('empty body'),
    })
    expect(validateFormattedText('<html><body>No</body></html>', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('HTML'),
    })
    expect(validateFormattedText('Too short', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('too short'),
    })
    expect(validateFormattedText('Access Denied by the proxy', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('error page'),
    })
    expect(validateFormattedText('---------------------', DOI)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('no citation text'),
    })
    expect(
      validateFormattedText('Doe, J. (2015). A Real Study. Journal.', 'not-a-doi'),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not a DOI'),
    })
  })
})

describe('format dispatch', () => {
  it('routes each declared format to its validator', () => {
    expect(validateCitation('csljson', JSON.stringify({ DOI, title: 'T' }), DOI).ok).toBe(true)
    expect(validateCitation('bibtex', `@article{x, DOI={${DOI}}}`, DOI).ok).toBe(true)
    expect(validateCitation('ris', `TY  - JOUR\nDO  - ${DOI}\nER  - `, DOI).ok).toBe(true)
    expect(validateCitation('text', 'Doe, J. (2015). A Real Study. Journal.', DOI).ok).toBe(true)
  })
})
