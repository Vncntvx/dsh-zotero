// @vitest-environment jsdom
/**
 * The citations lens: export artifact cards with full-text and \cite copy
 * affordances, per-item quick access with composer prefill, and the
 * no-artifact hint.
 * @module tests/client/ZoteroCiteLens
 */

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { buildCorpus, type Corpus } from '../../src/client/corpus.ts'
import { ZoteroCiteLens } from '../../src/client/ZoteroCiteLens.tsx'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  const icon = (name: string) => (props: Record<string, unknown>) =>
    createElement('span', { 'data-icon': name, ...props })
  return {
    StateDot: ({ state }: { state: string }) => createElement('span', { 'data-dot': state }),
    IconChevronDownOutline14: icon('chevron-down'),
    IconInspectOutline12: icon('inspect'),
    IconBrowseOutline16: icon('browse'),
    IconCopyOutline16: icon('copy'),
    IconSearchOutline16: icon('search'),
    CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code),
    writeClipboard: vi.fn(async () => true),
  }
})

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

const REF = 'zotero://user/0/item/ABCD1234'
const OTHER = 'zotero://user/0/item/EEEE2222'
const BIBTEX = '@article{pan2022carbon,\n title={A}\n}\n@book{dao2023,\n}'

function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2,
    callId: 'c1',
    call: { name: 'zotero_search', argsRaw: '{}' },
    callTime: 1,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...overrides,
  }
}

function exportBlocks(): ToolResultNode[] {
  return [
    settled({
      seq: 1,
      callId: 'e1',
      call: { name: 'zotero_export', argsRaw: `{"refs":["${REF}","${OTHER}"],"format":"bibtex"}` },
      meta: { format: 'bibtex', requested: 2, style: 'apa' },
      content: [{ type: 'text', text: BIBTEX }],
    }),
    settled({
      seq: 2,
      callId: 'e2',
      call: { name: 'zotero_export', argsRaw: '{"refs":[],"format":""}' },
      meta: { format: '' },
      content: [{ type: 'text', text: '{"pending":true}' }],
    }),
    settled({
      seq: 3,
      callId: 's',
      call: { name: 'zotero_search', argsRaw: '{}' },
      meta: {
        total: 1,
        items: [
          {
            ref: REF,
            title: 'Carbon price forecasting',
            creatorSummary: 'Di Pan',
            year: 2022,
            itemType: 'journalArticle',
          },
        ],
      },
    }),
  ]
}

function mountLens(blocks: ToolResultNode[]) {
  const corpus: Corpus = buildCorpus(blocks)
  const setDraft = vi.fn()
  const view = render(<ZoteroCiteLens corpus={corpus} t={t} setDraft={setDraft} />)
  return { view, corpus, setDraft }
}

afterEach(cleanup)

describe('ZoteroCiteLens', () => {
  it('renders compact artifact heads with format, style, and the keys preview', async () => {
    const { view } = mountLens(exportBlocks())
    await act(async () => {})
    expect(screen.getByText(zh.exportsLabel)).toBeDefined()
    expect(screen.getByText('bibtex')).toBeDefined()
    expect(screen.getByText('apa')).toBeDefined()
    // The extracted keys preview is the collapsed card's takeaway.
    expect(screen.getByText('pan2022carbon · dao2023')).toBeDefined()
    // Bodies stay collapsed by default; the JSON artifact has no keys.
    expect(screen.queryByText(/@article\{pan2022carbon,/)).toBeNull()
    expect(screen.queryByText(/\{"pending":true\}/)).toBeNull()
    view.unmount()
  })

  it('expands and collapses the artifact body on the chevron toggle', async () => {
    const { view } = mountLens(exportBlocks())
    await act(async () => {})
    const toggles = screen.getAllByLabelText(zh.artifactExpandLabel)
    expect(toggles).toHaveLength(2)
    fireEvent.click(toggles[1]!)
    await act(async () => {})
    expect(screen.getByText(/\{"pending":true\}/)).toBeDefined()
    fireEvent.click(toggles[0]!)
    await act(async () => {})
    expect(screen.getByText(/@article\{pan2022carbon,/)).toBeDefined()
    fireEvent.click(screen.getAllByLabelText(zh.artifactCollapseLabel)[0]!)
    await act(async () => {})
    expect(screen.queryByText(/@article\{pan2022carbon,/)).toBeNull()
    view.unmount()
  })

  it('copies the full text and the cite command over the extracted keys', async () => {
    const { view } = mountLens(exportBlocks())
    await act(async () => {})
    // The bibtex artifact is the first of the two copy-full-text buttons.
    fireEvent.click(screen.getAllByText(zh.copyFullText)[0]!)
    await act(async () => {})
    expect(writeClipboard).toHaveBeenCalledWith(BIBTEX)
    fireEvent.click(screen.getByText(zh.copyCite))
    await act(async () => {})
    expect(writeClipboard).toHaveBeenCalledWith('\\cite{pan2022carbon, dao2023}')
    view.unmount()
  })

  it('offers quick access with ref copy and a citation prefill', async () => {
    const { view, setDraft } = mountLens(exportBlocks())
    await act(async () => {})
    expect(screen.getByText(zh.quickAccessLabel)).toBeDefined()
    expect(screen.getByText('Carbon price forecasting')).toBeDefined()
    // One prefill button per literature row; both templates are handed over.
    for (const button of screen.getAllByText(zh.generateCitation)) {
      fireEvent.click(button)
    }
    expect(setDraft).toHaveBeenCalledWith(zh.citeTemplate.replace('{ref}', REF))
    expect(setDraft).toHaveBeenCalledWith(zh.citeTemplate.replace('{ref}', OTHER))
    view.unmount()
  })

  it('keeps the full literature in quick access when one item was cited', async () => {
    const other = 'zotero://user/0/item/EEEE2222'
    const { view, setDraft } = mountLens([
      settled({
        seq: 1,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          returned: 2,
          displayed: 2,
          omitted: 0,
          items: [
            {
              ref: REF,
              title: 'Carbon price forecasting',
              creatorSummary: 'A',
              itemType: 'report',
            },
            { ref: other, title: 'Another paper', creatorSummary: 'B', itemType: 'report' },
          ],
        },
      }),
      settled({
        seq: 2,
        callId: 'g',
        call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
        meta: {
          title: 'Carbon price forecasting',
          creators: 'A',
          notesPreview: [],
          annotationsPreview: [],
        },
      }),
      settled({
        seq: 3,
        callId: 'e',
        call: { name: 'zotero_export', argsRaw: `{"refs":["${REF}"],"format":"bibtex"}` },
        meta: { format: 'bibtex', requested: 1 },
        content: [{ type: 'text', text: '@book{x1,\n}' }],
      }),
    ])
    await act(async () => {})
    // The items lens would shrink to the read/cited target, but quick access
    // keeps every session paper so more citations can be generated.
    expect(screen.getByText('Carbon price forecasting')).toBeDefined()
    expect(screen.getByText('Another paper')).toBeDefined()
    expect(screen.getAllByText(zh.generateCitation)).toHaveLength(2)
    fireEvent.click(screen.getAllByText(zh.generateCitation)[1]!)
    expect(setDraft).toHaveBeenCalledWith(zh.citeTemplate.replace('{ref}', other))
    view.unmount()
  })

  it('renders the full artifact text uncapped once expanded', async () => {
    const long = 'x'.repeat(1300)
    const { view } = mountLens([
      settled({
        seq: 1,
        callId: 'long',
        call: { name: 'zotero_export', argsRaw: '{"format":"json"}' },
        meta: { format: 'json' },
        content: [{ type: 'text', text: long }],
      }),
    ])
    await act(async () => {})
    expect(screen.queryByText(long)).toBeNull()
    fireEvent.click(screen.getByLabelText(zh.artifactExpandLabel))
    await act(async () => {})
    expect(screen.getByText(long)).toBeDefined()
    fireEvent.click(screen.getByText(zh.copyFullText))
    await act(async () => {})
    expect(writeClipboard).toHaveBeenCalledWith(long)
    view.unmount()
  })

  it('shows the hint and starter without artifacts; hides the starter without a composer', async () => {
    const searchOnly = [
      settled({
        seq: 1,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          total: 1,
          items: [{ ref: REF, title: 'T', creatorSummary: 'C', itemType: 'report' }],
        },
      }),
    ]
    const { view, setDraft } = mountLens(searchOnly)
    await act(async () => {})
    expect(screen.getByText(zh.noExportsHint)).toBeDefined()
    fireEvent.click(screen.getByText(zh.starterCite))
    expect(setDraft).toHaveBeenCalledWith(zh.starterCiteTemplate)
    view.unmount()

    const corpus = buildCorpus([])
    const bare = render(<ZoteroCiteLens corpus={corpus} t={t} />)
    await act(async () => {})
    expect(screen.getByText(zh.noExportsHint)).toBeDefined()
    expect(screen.queryByText(zh.starterCite)).toBeNull()
    expect(screen.queryByText(zh.quickAccessLabel)).toBeNull()
    bare.unmount()
  })
})
