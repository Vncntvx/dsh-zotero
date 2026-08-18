// @vitest-environment jsdom
/**
 * The exports lens: successful exports as per-format sections of deduplicated
 * documents — the format head with its count and copy-all / download-all
 * actions, per-document rows (citation key, weak title line, \cite copy,
 * single-document download, disclosure into the verbatim entry) — with
 * artifacts without per-document data falling back to whole-text call rows,
 * and the incomplete-operations note. The static-export disclaimer is a
 * README concern, never a UI line.
 * @module tests/client/ExportsLens
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportDocumentRow } from '../../src/client/components/ExportDocumentRow.tsx'
import {
  ExportCard,
  artifactTimeOf,
  extensionOf,
  fileNameOf,
  formatLabelOf,
  mimeOf,
} from '../../src/client/components/ExportCard.tsx'
import { ExportSections, sectionTextOf } from '../../src/client/components/ExportSections.tsx'
import { incompleteExportsNoteOf } from '../../src/client/components/operations.ts'
import { ExportsPage } from '../../src/client/components/workspace/ExportsPage.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import { bibTexKeysOf, citeCommandOf } from '../../src/client/sources/bibtex.ts'
import type { ExportArtifact } from '../../src/client/sources/model.ts'
import type { ExportedDocument } from '../../src/client/sources/selectors.ts'
import { workspaceOf } from './helpers/source-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    IconChevronDownOutline14: (props: Record<string, unknown>) =>
      createElement('span', { 'data-icon': 'chevron-down', ...props }),
    writeClipboard: vi.fn(async () => true),
  }
})

const { writeClipboard } = vi.mocked(
  await vi.importMock<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(
    '@deepseek-ai/dsh-client-ui-primitives',
  ),
)

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

const REF_A = 'zotero://user/0/item/AAAAAAA1'
const REF_B = 'zotero://user/0/item/BBBBBBBB'

const BIBTEX_TEXT = '@article{dao2023,\n title={A study on dao}\n}'
const RIS_TEXT = 'TY  - JOUR\nTI  - A RIS record\nID  - BBBBBBBB\nER  -\n'

/** An itemized BibTeX artifact whose item locates its entry in the body. */
function itemizedBibtex(overrides: Partial<ExportArtifact> = {}): ExportArtifact {
  return {
    callId: 'e1',
    format: 'bibtex',
    refs: [REF_A],
    refsOmitted: 0,
    text: BIBTEX_TEXT,
    items: [
      { ref: REF_A, key: 'dao2023', title: 'A study on dao', start: 0, end: BIBTEX_TEXT.length },
    ],
    ...overrides,
  }
}

/** An itemized RIS artifact whose item locates its record in the body. */
function itemizedRis(overrides: Partial<ExportArtifact> = {}): ExportArtifact {
  return {
    callId: 'e2',
    format: 'ris',
    refs: [REF_B],
    refsOmitted: 0,
    text: RIS_TEXT,
    items: [{ ref: REF_B, title: 'A RIS record', start: 0, end: RIS_TEXT.length }],
    ...overrides,
  }
}

const BIBTEX_ARTIFACT: ExportArtifact = {
  callId: 'e1',
  format: 'bibtex',
  style: 'apa',
  locale: 'en-US',
  refs: [REF_A, 'zotero://user/0/item/AAAAAAA2'],
  refsOmitted: 0,
  text: '@article{dao2023,\n title={A}\n}',
}

const BIBTEX_DOC: ExportedDocument = {
  ref: REF_A,
  format: 'bibtex',
  key: 'dao2023',
  title: 'A study on dao',
  text: '@article{dao2023,\n title={A study on dao}\n}',
  callIds: ['e1'],
  latestExportedAt: 1720000000000,
}

const RIS_DOC: ExportedDocument = {
  ref: REF_B,
  format: 'ris',
  title: 'A RIS record',
  text: 'TY  - JOUR\nTI  - A RIS record\nID  - BBBBBBBB\nER  -\n',
  callIds: ['e2'],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('formatLabelOf', () => {
  it('renders the known translator ids in proper case and localizes the CSL formats', () => {
    expect(formatLabelOf('bibtex', t)).toBe('BibTeX')
    expect(formatLabelOf('biblatex', t)).toBe('BibLaTeX')
    expect(formatLabelOf('ris', t)).toBe('RIS')
    expect(formatLabelOf('csljson', t)).toBe('CSL JSON')
    expect(formatLabelOf('citation', t)).toBe(zh.formatCitation)
    expect(formatLabelOf('bibliography', t)).toBe(zh.formatBibliography)
  })

  it('keeps unknown translator names verbatim and names a factless artifact', () => {
    expect(formatLabelOf('coolmine', t)).toBe('coolmine')
    expect(formatLabelOf('', t)).toBe(zh.formatUnknown)
  })
})

describe('incompleteExportsNoteOf', () => {
  it('joins only the non-zero counts and stays empty when all exports succeeded', () => {
    expect(incompleteExportsNoteOf({ running: 1, failed: 2, stopped: 0 }, t)).toBe(
      '进行中 1 · 失败 2',
    )
    expect(incompleteExportsNoteOf({ running: 0, failed: 0, stopped: 0 }, t)).toBe('')
  })
})

describe('bibtex helpers', () => {
  it('extracts unique keys in first-seen order and joins the cite command', () => {
    const text = '@article{a,\n}\n@book{b,\n}\n@article{a,\n}'
    expect(bibTexKeysOf(text)).toEqual(['a', 'b'])
    expect(bibTexKeysOf('nothing')).toEqual([])
    expect(citeCommandOf(['a', 'b'])).toBe('\\cite{a, b}')
    expect(citeCommandOf([])).toBe('')
  })
})

describe('ExportCard', () => {
  it('names the artifact by format with the scope facts on the head line', () => {
    render(<ExportCard artifact={BIBTEX_ARTIFACT} t={t} />)
    expect(screen.getByText('BibTeX')).toBeDefined()
    expect(screen.getByText(/apa/)).toBeDefined()
    expect(screen.getByText(/en-US/)).toBeDefined()
    expect(screen.getByText(new RegExp(zh.exportRefCount.replace('{count}', '2')))).toBeDefined()
  })

  it('keeps the keys, cite command, and verbatim body behind the disclosure', () => {
    render(<ExportCard artifact={BIBTEX_ARTIFACT} t={t} />)
    // Collapsed: no keys, no verbatim body in the DOM.
    expect(screen.queryAllByText(/dao2023/)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getAllByText(/dao2023/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/@article\{dao2023/)).toBeDefined()
    fireEvent.click(screen.getByLabelText(zh.copyCite))
    expect(writeClipboard).toHaveBeenCalledWith('\\cite{dao2023}')
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryAllByText(/dao2023/)).toHaveLength(0)
  })

  it('copies the full export text from the always-visible action', () => {
    render(<ExportCard artifact={BIBTEX_ARTIFACT} t={t} />)
    fireEvent.click(screen.getByLabelText(zh.copyExport))
    expect(writeClipboard).toHaveBeenCalledWith(BIBTEX_ARTIFACT.text)
  })

  it('notes the refs omitted by the bounded projection and skips the cite button without keys', () => {
    const bounded: ExportArtifact = {
      ...BIBTEX_ARTIFACT,
      refsOmitted: 3,
      text: 'no entries here',
    }
    render(<ExportCard artifact={bounded} t={t} />)
    expect(screen.getByText(new RegExp(zh.exportRefsOmitted.replace('{count}', '3')))).toBeDefined()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.queryByLabelText(zh.copyCite)).toBeNull()
  })
})

describe('ExportDocumentRow', () => {
  it('names the document by its citation key with the title as the weak second line', () => {
    render(<ExportDocumentRow doc={BIBTEX_DOC} t={t} />)
    expect(screen.getByText('dao2023')).toBeDefined()
    expect(screen.getByText('A study on dao')).toBeDefined()
    expect(screen.getByLabelText(zh.copyCite)).toBeDefined()
    // The verbatim entry stays behind the disclosure.
    expect(screen.queryAllByText(/@article\{dao2023/)).toHaveLength(0)
  })

  it('keeps the verbatim entry and its copy action behind the disclosure', () => {
    render(<ExportDocumentRow doc={BIBTEX_DOC} t={t} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    // The code surface names the format in its head and keeps the copy
    // action inside, so the row header itself never changes on expand.
    expect(screen.getByText('BibTeX')).toBeDefined()
    expect(screen.getByText(/@article\{dao2023/)).toBeDefined()
    fireEvent.click(screen.getByLabelText(zh.copyExport))
    expect(writeClipboard).toHaveBeenCalledWith(BIBTEX_DOC.text)
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryAllByText(/@article\{dao2023/)).toHaveLength(0)
  })

  it('copies the per-document cite command from the always-visible action', () => {
    render(<ExportDocumentRow doc={BIBTEX_DOC} t={t} />)
    fireEvent.click(screen.getByLabelText(zh.copyCite))
    expect(writeClipboard).toHaveBeenCalledWith('\\cite{dao2023}')
  })

  it('skips the cite button and the title line for documents without a key', () => {
    render(<ExportDocumentRow doc={RIS_DOC} t={t} />)
    // The title is the main line; there is no key to cite and no second line.
    expect(screen.getByText('A RIS record')).toBeDefined()
    expect(screen.queryByLabelText(zh.copyCite)).toBeNull()
    expect(screen.getAllByText('A RIS record')).toHaveLength(1)
  })

  it('downloads the single document as a blob named by its key', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportDocumentRow doc={BIBTEX_DOC} t={t} />)
    fireEvent.click(screen.getByText(`${zh.downloadArtifact} ${extensionOf('bibtex')}`))
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('zotero-dao2023.bib')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledTimes(1)
    create.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('names a keyless download by the item key', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportDocumentRow doc={RIS_DOC} t={t} />)
    fireEvent.click(screen.getByText(`${zh.downloadArtifact} ${extensionOf('ris')}`))
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('zotero-BBBBBBBB.ris')
    // Let the scheduled URL release run before the next test's spy lands.
    await new Promise((resolve) => setTimeout(resolve, 0))
    create.mockRestore()
    click.mockRestore()
  })

  it('falls back the download name for a ref without an item key', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportDocumentRow doc={{ ...RIS_DOC, ref: 'not-a-zotero-ref' }} t={t} />)
    fireEvent.click(screen.getByText(`${zh.downloadArtifact} ${extensionOf('ris')}`))
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('zotero-export.ris')
    await new Promise((resolve) => setTimeout(resolve, 0))
    create.mockRestore()
    click.mockRestore()
  })

  it('falls back to the format label when the document has neither key nor title', () => {
    render(
      <ExportDocumentRow
        doc={{ ref: REF_B, format: 'ris', text: 'TY  - JOUR\nER  -\n', callIds: ['e2'] }}
        t={t}
      />,
    )
    expect(screen.getByText('RIS')).toBeDefined()
    expect(screen.queryByLabelText(zh.copyCite)).toBeNull()
  })
})

describe('sectionTextOf', () => {
  it('joins the documents in display order', () => {
    const section = {
      format: 'bibtex',
      documents: [BIBTEX_DOC],
      unresolved: [],
      unresolvedItems: [],
    }
    expect(sectionTextOf(section)).toBe(BIBTEX_DOC.text)
    expect(sectionTextOf({ ...section, documents: [BIBTEX_DOC, RIS_DOC] })).toBe(
      `${BIBTEX_DOC.text}\n\n${RIS_DOC.text}`,
    )
  })
})

describe('ExportSections', () => {
  it('groups documents into format sections with the count and section-wide actions', () => {
    render(<ExportSections exports={[itemizedBibtex(), itemizedRis()]} t={t} />)
    expect(screen.getByText('BibTeX')).toBeDefined()
    expect(screen.getByText('RIS')).toBeDefined()
    // The section count is the deduplicated document count, one per section.
    expect(screen.getAllByText('1')).toHaveLength(2)
    expect(screen.getAllByLabelText(zh.copyAll)).toHaveLength(2)
    expect(screen.getByText(`${zh.downloadAll} ${extensionOf('bibtex')}`)).toBeDefined()
    expect(screen.getByText(`${zh.downloadAll} ${extensionOf('ris')}`)).toBeDefined()
  })

  it('collapses repeated exports into one row and copies the latest entry with copy-all', () => {
    const updated = '@article{dao2023,\n title={A study on dao, revised}\n}'
    const first = itemizedBibtex({ callId: 'e1', settledAt: 1000 })
    const second = itemizedBibtex({
      callId: 'e2',
      settledAt: 2000,
      text: updated,
      items: [
        {
          ref: REF_A,
          key: 'dao2023',
          title: 'A study on dao, revised',
          start: 0,
          end: updated.length,
        },
      ],
    })
    render(<ExportSections exports={[first, second]} t={t} />)
    // One section, one document row — the latest entry wins, no duplicates.
    expect(screen.getAllByText('dao2023')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText(zh.copyAll))
    expect(writeClipboard).toHaveBeenCalledWith(updated)
  })

  it('reports unlocatable items as a light note with the full text download', async () => {
    const artifact = itemizedBibtex({
      callId: 'e1',
      refs: [REF_A, 'zotero://user/0/item/CCCCCCCC'],
      items: [
        { ref: REF_A, key: 'dao2023', title: 'A study on dao', start: 0, end: BIBTEX_TEXT.length },
        // The provider could not locate this item in the body.
        { ref: 'zotero://user/0/item/CCCCCCCC', key: 'other' },
      ],
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportSections exports={[artifact]} t={t} />)
    // The located document still renders; the unlocated item gets the light
    // note instead of hiding the whole export.
    expect(screen.getByText('dao2023')).toBeDefined()
    expect(screen.getByText(zh.unresolvedItemsNote.replace('{count}', '1'))).toBeDefined()
    fireEvent.click(screen.getByText(`${zh.downloadFull} BibTeX`))
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('zotero-bibtex.bib')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledTimes(1)
    create.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('downloads the joined latest entries as one file', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportSections exports={[itemizedBibtex(), itemizedRis()]} t={t} />)
    fireEvent.click(screen.getByText(`${zh.downloadAll} ${extensionOf('bibtex')}`))
    expect(create).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('zotero-bibtex.bib')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledTimes(1)
    create.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('falls back artifacts without per-document data to whole-text call rows', () => {
    const bibliography: ExportArtifact = {
      callId: 'e2',
      format: 'bibliography',
      refs: [REF_A],
      refsOmitted: 0,
      text: '<div>a bibliography</div>',
    }
    const legacy = itemizedBibtex({ callId: 'e3', items: undefined })
    render(<ExportSections exports={[bibliography, legacy]} t={t} />)
    // A document-less section has no head and no copy-all action.
    expect(screen.queryByLabelText(zh.copyAll)).toBeNull()
    expect(screen.getByText(zh.formatBibliography)).toBeDefined()
    expect(screen.getByText('BibTeX')).toBeDefined()
    expect(screen.queryByText('dao2023')).toBeNull()
  })
})

describe('ExportsPage', () => {
  it('shows the honest empty note without successful exports', () => {
    render(<ExportsPage workspace={workspaceOf([])} t={t} />)
    expect(screen.getByText(zh.exportsEmptyNote)).toBeDefined()
  })

  it('keeps failed and running operations visible when no artifact succeeded', () => {
    render(
      <ExportsPage
        workspace={workspaceOf([], {
          exports: [],
          exportOperations: { running: 1, failed: 2, stopped: 0 },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(zh.exportsEmptyNote)).toBeDefined()
    expect(
      screen.getByText(zh.exportsIncompleteNote.replace('{counts}', '进行中 1 · 失败 2')),
    ).toBeDefined()
  })

  it('renders the document sections with the incomplete operations', () => {
    const bibliography: ExportArtifact = {
      callId: 'e2',
      format: 'bibliography',
      refs: [REF_B],
      refsOmitted: 0,
      text: '<div>a bibliography</div>',
    }
    render(
      <ExportsPage
        workspace={workspaceOf([], {
          exports: [itemizedBibtex(), bibliography],
          exportOperations: { running: 0, failed: 1, stopped: 1 },
        })}
        t={t}
      />,
    )
    // The itemized BibTeX export renders as a document row under its head.
    expect(screen.getByText('dao2023')).toBeDefined()
    expect(screen.getByText(/失败 1 · 已停止 1/)).toBeDefined()
    // The bibliography stays a whole-text call row without a section head.
    expect(screen.getByText(zh.formatBibliography)).toBeDefined()
  })
})

describe('artifact file and time facts', () => {
  it('maps export formats to extensions and MIME types', () => {
    expect(extensionOf('bibtex')).toBe('.bib')
    expect(extensionOf('biblatex')).toBe('.bib')
    expect(extensionOf('ris')).toBe('.ris')
    expect(extensionOf('csljson')).toBe('.json')
    expect(extensionOf('citation')).toBe('.txt')
    expect(extensionOf('unknown')).toBe('.txt')
    expect(mimeOf('csljson')).toBe('application/json')
    expect(mimeOf('ris')).toBe('application/x-research-info-systems')
    expect(mimeOf('bibtex')).toBe('text/plain')
    expect(mimeOf('citation')).toBe('text/plain')
  })

  it('sanitizes the download filename and formats the settled time', () => {
    expect(fileNameOf({ ...BIBTEX_ARTIFACT, format: 'bibtex' })).toBe('zotero-bibtex.bib')
    expect(fileNameOf({ ...BIBTEX_ARTIFACT, format: 'bad/name' })).toBe('zotero-bad-name.txt')
    expect(fileNameOf({ ...BIBTEX_ARTIFACT, format: '' })).toBe('zotero-export.txt')
    expect(artifactTimeOf({ ...BIBTEX_ARTIFACT, settledAt: 0 })).toMatch(/^\d{2}:\d{2}$/)
    expect(artifactTimeOf(BIBTEX_ARTIFACT)).toBe('')
  })

  it('downloads the full text as a blob and revokes the URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportCard artifact={{ ...BIBTEX_ARTIFACT, settledAt: 1720000000000 }} t={t} />)
    // The download action names the file it produces.
    fireEvent.click(screen.getByText(`${zh.downloadArtifact} ${extensionOf('bibtex')}`))
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    // The URL release is scheduled right after the click, never leaked.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revoke).toHaveBeenCalledTimes(1)
    create.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })
})
