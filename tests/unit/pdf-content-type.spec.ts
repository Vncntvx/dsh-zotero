/**
 * The two PDF questions, kept apart by name.
 *
 * \`isPdfContentType\` asks whether a known MIME type is exactly PDF;
 * \`isPdfCandidateContentType\` asks whether a source is worth handing to the
 * parser, which includes a missing type. They shared a name once, so an import
 * could silently swap one answer for the other.
 * @module tests/unit/pdf-content-type
 */

import { describe, expect, it } from 'vitest'
import { isPdfContentType } from '../../src/media-types.ts'
import { isPdfCandidateContentType } from '../../src/local/fulltext-enhancer.ts'

describe('the PDF predicates', () => {
  it('answers exactly-PDF for a known content type', () => {
    expect(isPdfContentType('application/pdf')).toBe(true)
    expect(isPdfContentType('application/pdf; charset=utf-8')).toBe(false)
    expect(isPdfContentType(undefined)).toBe(false)
    expect(isPdfContentType('text/html')).toBe(false)
  })

  it('answers candidate for a missing or parameterized content type', () => {
    expect(isPdfCandidateContentType(undefined)).toBe(true)
    expect(isPdfCandidateContentType('   ')).toBe(true)
    expect(isPdfCandidateContentType('application/pdf; charset=utf-8')).toBe(true)
    expect(isPdfCandidateContentType('APPLICATION/PDF')).toBe(true)
    expect(isPdfCandidateContentType('text/html')).toBe(false)
  })
})
