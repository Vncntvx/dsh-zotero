// @vitest-environment jsdom
/**
 * The exports lens: successful artifacts only, format and scope facts,
 * the BibTeX key convenience, the copy actions, the incomplete-operations
 * note, and the static-export disclaimer.
 * @module tests/client/ExportsLens
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportCard, formatLabelOf } from '../../src/client/components/ExportCard.tsx'
import { ExportsLens, incompleteExportsNoteOf } from '../../src/client/components/ExportsLens.tsx'
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
  it('localizes the CSL formats and keeps translator names verbatim', () => {
    expect(formatLabelOf('citation', t)).toBe(zh.formatCitation)
    expect(formatLabelOf('bibliography', t)).toBe(zh.formatBibliography)
    expect(formatLabelOf('bibtex', t)).toBe('bibtex')
  })

  it('names an artifact without usable format facts', () => {
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
  it('shows the format, style, and ref scope facts', () => {
    render(<ExportCard artifact={BIBTEX_ARTIFACT} ordinal={1} t={t} />)
    expect(screen.getByText(`1. ${BIBTEX_ARTIFACT.format}`)).toBeDefined()
    expect(screen.getByText('apa')).toBeDefined()
    expect(screen.getByText('en-US')).toBeDefined()
    expect(screen.getByText(zh.exportRefCount.replace('{count}', '2'))).toBeDefined()
    expect(screen.getByText('dao2023')).toBeDefined()
  })

  it('copies the export text and the cite command, and expands the body', () => {
    render(<ExportCard artifact={BIBTEX_ARTIFACT} ordinal={1} t={t} />)
    fireEvent.click(screen.getByLabelText(zh.copyExport))
    expect(writeClipboard).toHaveBeenCalledWith(BIBTEX_ARTIFACT.text)
    fireEvent.click(screen.getByLabelText(zh.copyCite))
    expect(writeClipboard).toHaveBeenCalledWith('\\cite{dao2023}')
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/@article\{dao2023/)).toBeDefined()
  })

  it('notes the refs omitted by the bounded projection and skips the cite button without keys', () => {
    const bounded: ExportArtifact = {
      ...BIBTEX_ARTIFACT,
      refsOmitted: 3,
      text: 'no entries here',
    }
    render(<ExportCard artifact={bounded} ordinal={2} t={t} />)
    expect(screen.getByText(new RegExp(zh.exportRefsOmitted.replace('{count}', '3')))).toBeDefined()
    expect(screen.queryByLabelText(zh.copyCite)).toBeNull()
  })
})

describe('ExportsLens', () => {
  it('shows the honest empty note without successful exports', () => {
    render(<ExportsLens workspace={workspaceOf([])} t={t} />)
    expect(screen.getByText(zh.exportsEmptyNote)).toBeDefined()
  })

  it('keeps failed and running operations visible when no artifact succeeded', () => {
    render(
      <ExportsLens
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
    expect(screen.queryByText(zh.exportsStaticNote)).toBeNull()
  })

  it('lists the artifacts, the incomplete operations, and the static disclaimer', () => {
    const second: ExportArtifact = {
      callId: 'e2',
      format: 'bibliography',
      refs: ['zotero://user/0/item/AAAAAAA3'],
      refsOmitted: 0,
      text: '<div>a bibliography</div>',
    }
    render(
      <ExportsLens
        workspace={workspaceOf([], {
          exports: [BIBTEX_ARTIFACT, second],
          exportOperations: { running: 0, failed: 1, stopped: 1 },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(`1. ${BIBTEX_ARTIFACT.format}`)).toBeDefined()
    expect(screen.getByText(`2. ${zh.formatBibliography}`)).toBeDefined()
    expect(
      screen.getByText(zh.exportsIncompleteNote.replace('{counts}', '失败 1 · 已停止 1')),
    ).toBeDefined()
    expect(screen.getByText(/失败 1 · 已停止 1/)).toBeDefined()
    expect(screen.getByText(zh.exportsStaticNote)).toBeDefined()
  })
})
