// @vitest-environment jsdom
/**
 * The exports lens: successful artifacts only, format and scope facts, the
 * disclosure contract (keys and verbatim body behind the toggle), the copy
 * and download actions, and the incomplete-operations note. The
 * static-export disclaimer is a README concern, never a UI line.
 * @module tests/client/ExportsLens
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExportCard,
  artifactTimeOf,
  extensionOf,
  fileNameOf,
  formatLabelOf,
  mimeOf,
} from '../../src/client/components/ExportCard.tsx'
import { incompleteExportsNoteOf } from '../../src/client/components/operations.ts'
import { ExportsPage } from '../../src/client/components/workspace/ExportsPage.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import { bibTexKeysOf, citeCommandOf } from '../../src/client/sources/bibtex.ts'
import type { ExportArtifact } from '../../src/client/sources/model.ts'
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

const BIBTEX_ARTIFACT: ExportArtifact = {
  callId: 'e1',
  format: 'bibtex',
  style: 'apa',
  locale: 'en-US',
  refs: ['zotero://user/0/item/AAAAAAA1', 'zotero://user/0/item/AAAAAAA2'],
  refsOmitted: 0,
  text: '@article{dao2023,\n title={A}\n}',
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

  it('lists the artifacts as disclosure rows with the incomplete operations', () => {
    const second: ExportArtifact = {
      callId: 'e2',
      format: 'bibliography',
      refs: ['zotero://user/0/item/AAAAAAA3'],
      refsOmitted: 0,
      text: '<div>a bibliography</div>',
    }
    render(
      <ExportsPage
        workspace={workspaceOf([], {
          exports: [BIBTEX_ARTIFACT, second],
          exportOperations: { running: 0, failed: 1, stopped: 1 },
        })}
        t={t}
      />,
    )
    expect(screen.getByText('BibTeX')).toBeDefined()
    expect(screen.getByText(zh.formatBibliography)).toBeDefined()
    expect(screen.getByText(/失败 1 · 已停止 1/)).toBeDefined()
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
