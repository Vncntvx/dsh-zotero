/**
 * Tests for pure export formatting helpers: format labels, extensions, MIME types,
 * filename sanitization, filename synthesis, and artifact timestamps.
 * @module tests/client/export-formats
 */

import { describe, expect, it } from 'vitest'
import {
  artifactTimeOf,
  extensionOf,
  fileNameForFormat,
  fileNameOf,
  formatLabelOf,
  mimeOf,
  sanitizeFileStem,
} from '../../src/client/export-formats.ts'
import { zh } from '../../src/client/locales.ts'
import type { ExportArtifact } from '../../src/client/sources/model.ts'

import { mockT } from './helpers/mock-translate.ts'

const t = mockT

describe('formatLabelOf', () => {
  it('returns proper case for known citation formats', () => {
    expect(formatLabelOf('bibtex', t)).toBe('BibTeX')
    expect(formatLabelOf('biblatex', t)).toBe('BibLaTeX')
    expect(formatLabelOf('ris', t)).toBe('RIS')
    expect(formatLabelOf('csljson', t)).toBe('CSL JSON')
  })

  it('localizes citation and bibliography formats', () => {
    expect(formatLabelOf('citation', t)).toBe(zh.formatCitation)
    expect(formatLabelOf('bibliography', t)).toBe(zh.formatBibliography)
  })

  it('handles unknown or empty format names', () => {
    expect(formatLabelOf('custom_fmt', t)).toBe('custom_fmt')
    expect(formatLabelOf('', t)).toBe(zh.formatUnknown)
  })
})

describe('extensionOf', () => {
  it('maps known export formats to extensions', () => {
    expect(extensionOf('bibtex')).toBe('.bib')
    expect(extensionOf('biblatex')).toBe('.bib')
    expect(extensionOf('ris')).toBe('.ris')
    expect(extensionOf('csljson')).toBe('.json')
    expect(extensionOf('citation')).toBe('.txt')
    expect(extensionOf('bibliography')).toBe('.txt')
  })

  it('falls back to .txt for unknown formats', () => {
    expect(extensionOf('unknown')).toBe('.txt')
  })
})

describe('mimeOf', () => {
  it('maps known formats to MIME types', () => {
    expect(mimeOf('ris')).toBe('application/x-research-info-systems')
    expect(mimeOf('csljson')).toBe('application/json')
    expect(mimeOf('citation')).toBe('text/plain')
    expect(mimeOf('bibliography')).toBe('text/plain')
    expect(mimeOf('bibtex')).toBe('text/plain')
    expect(mimeOf('biblatex')).toBe('text/plain')
    expect(mimeOf('unknown')).toBe('text/plain')
  })
})

describe('sanitizeFileStem', () => {
  it('removes invalid characters', () => {
    expect(sanitizeFileStem('my:cool/stem?*<file>')).toBe('my-cool-stem---file-')
    expect(sanitizeFileStem('')).toBe('export')
  })
})

describe('fileNameForFormat and fileNameOf', () => {
  it('constructs predictable filename', () => {
    expect(fileNameForFormat('bibtex')).toBe('zotero-bibtex.bib')
    expect(fileNameForFormat('ris')).toBe('zotero-ris.ris')
    expect(fileNameForFormat('csljson')).toBe('zotero-csljson.json')
  })

  it('constructs filename from artifact', () => {
    const artifact: ExportArtifact = {
      callId: 'call_1',
      format: 'biblatex',
      text: '@article{test, title={Test}}',
      refs: ['zotero://user/0/item/ABCDEFGH'],
      refsOmitted: 0,
    }
    expect(fileNameOf(artifact)).toBe('zotero-biblatex.bib')
  })
})

describe('artifactTimeOf', () => {
  it('formats timestamp to HH:MM when present', () => {
    const artifactWithTime: ExportArtifact = {
      callId: 'call_1',
      format: 'bibtex',
      text: '',
      refs: [],
      refsOmitted: 0,
      settledAt: new Date(2025, 0, 1, 14, 30, 0).getTime(),
    }
    expect(artifactTimeOf(artifactWithTime)).toBe('14:30')
  })

  it('returns empty string when settledAt is undefined', () => {
    const artifactWithoutTime: ExportArtifact = {
      callId: 'call_1',
      format: 'bibtex',
      text: '',
      refs: [],
      refsOmitted: 0,
    }
    expect(artifactTimeOf(artifactWithoutTime)).toBe('')
  })
})
