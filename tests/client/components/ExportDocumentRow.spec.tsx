// @vitest-environment jsdom
/**
 * Branch tests for ExportDocumentRow: citation key source decoration,
 * citation key conflict notice, and export-key title presentation.
 * @module tests/client/components/ExportDocumentRow
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportDocumentRow } from '../../../src/client/components/ExportDocumentRow.tsx'
import type { ExportedDocument } from '../../../src/client/sources/selectors.ts'
import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

const BASE_DOC: ExportedDocument = {
  format: 'bibtex',
  ref: 'zotero://user/0/item/AAAAAAA1',
  text: '@article{dao2023,\n title={A study}\n}',
  callIds: ['c1'],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExportDocumentRow branch coverage', () => {
  it('renders citation key with source annotation', () => {
    const doc: ExportedDocument = {
      ...BASE_DOC,
      citationKey: 'dao2023',
      citationKeySource: 'extra',
    }
    render(<ExportDocumentRow doc={doc} t={t} />)
    expect(
      screen.getByText(
        t('toolZoteroCitationKeyLine', {
          source: ' (extra)',
          key: 'dao2023',
        }),
      ),
    ).toBeDefined()
  })

  it('renders citation key without source annotation', () => {
    const doc: ExportedDocument = {
      ...BASE_DOC,
      citationKey: 'dao2023',
    }
    render(<ExportDocumentRow doc={doc} t={t} />)
    expect(
      screen.getByText(
        t('toolZoteroCitationKeyLine', {
          source: '',
          key: 'dao2023',
        }),
      ),
    ).toBeDefined()
  })

  it('renders citation key conflict warning', () => {
    const doc: ExportedDocument = {
      ...BASE_DOC,
      citationKeyConflict: {
        native: 'native-key',
        extra: 'extra-key',
      },
    }
    render(<ExportDocumentRow doc={doc} t={t} />)
    expect(
      screen.getByText(
        t('toolCitationKeyConflict', {
          native: 'native-key',
          extra: 'extra-key',
        }),
      ),
    ).toBeDefined()
  })

  it('renders document title when exportKey and title are present', () => {
    const doc: ExportedDocument = {
      ...BASE_DOC,
      exportKey: 'export-entry-1',
      title: 'Explicit Title Line',
    }
    render(<ExportDocumentRow doc={doc} t={t} />)
    expect(screen.getByText('Explicit Title Line')).toBeDefined()
  })
})
