// @vitest-environment jsdom
/**
 * The items lens: the provenance caption, aggregated rows with usage badges,
 * line-end actions (copy ref / ask about this), the content-gated expandable
 * dossier (previews, evidence, attachment), composer prefill, and the
 * empty/omitted states.
 * @module tests/client/ZoteroItemsLens
 */

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type {
  ConversationSnapshot,
  RunningToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCorpus, type Corpus } from '../../src/client/corpus.ts'
import { ZoteroItemsLens } from '../../src/client/ZoteroItemsLens.tsx'
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

void (null as unknown as ConversationSnapshot)

/** The full journey of one item: searched, read, cited, attached. */
function journeyBlocks(): ToolResultNode[] {
  return [
    settled({
      seq: 1,
      callId: 's',
      call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
      meta: {
        returned: 4,
        total: 4,
        displayed: 1,
        omitted: 3,
        items: [
          {
            ref: REF,
            title: 'Search title',
            creatorSummary: 'Dao',
            year: 2023,
            itemType: 'journalArticle',
          },
        ],
      },
    }),
    settled({
      seq: 2,
      callId: 'g',
      call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}?server=X"}` },
      meta: {
        title: 'Full title',
        creators: 'Di Pan',
        year: 2022,
        venue: 'ESPR',
        notesPreview: [{ ref: 'zotero://user/0/item/NOTE0001', preview: 'a personal note' }],
        annotationsPreview: [
          {
            ref: 'zotero://user/0/annotation/ANN0002',
            preview: 'a personal annotation',
            pageLabel: '3',
          },
        ],
      },
    }),
    settled({
      seq: 3,
      callId: 'r',
      call: { name: 'zotero_retrieve', argsRaw: `{"ref":"${REF}"}` },
      meta: {
        count: 1,
        sources: ['annotation'],
        truncated: false,
        sourcesSkipped: [],
        items: [
          {
            source: 'annotation',
            sourceRef: 'zotero://user/0/annotation/ANN1',
            preview: 'the claim',
            previewTruncated: false,
            pageLabel: '7',
          },
        ],
      },
    }),
    settled({
      seq: 4,
      callId: 'a',
      call: { name: 'zotero_attachment', argsRaw: `{"ref":"${REF}"}` },
      meta: { kind: 'file', title: 'a.pdf', contentType: 'application/pdf', path: '/tmp/a.pdf' },
    }),
    settled({
      seq: 5,
      callId: 'e',
      call: { name: 'zotero_export', argsRaw: `{"refs":["${REF}"],"format":"bibtex"}` },
      meta: { format: 'bibtex', requested: 1 },
      content: [{ type: 'text', text: '@book{x1,\n  title={T}\n}' }],
    }),
  ]
}

/** Render one lens over a corpus built from fixture blocks. */
function mountLens(blocks: ToolResultNode[] = [], running: RunningToolCall[] = []) {
  const corpus: Corpus = buildCorpus([...blocks, ...running])
  const setDraft = vi.fn()
  const view = render(<ZoteroItemsLens corpus={corpus} t={t} setDraft={setDraft} />)
  return { view, corpus, setDraft }
}

/** The expandable row toggle (the only element carrying aria-expanded). */
function toggleOf() {
  return screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-expanded') !== null)
}

afterEach(cleanup)

describe('ZoteroItemsLens', () => {
  it('renders the worked-on target with its badges and the processed caption', () => {
    const { view } = mountLens(journeyBlocks())
    expect(screen.getByText('Full title')).toBeDefined()
    expect(screen.getByText(zh.badgeRead)).toBeDefined()
    // Evidence gathering and export fold into the single cited badge.
    expect(screen.getAllByText(zh.badgeCited)).toHaveLength(1)
    expect(screen.getByText(zh.badgePdf)).toBeDefined()
    // The list states what it is, so a one-row target list never reads as
    // a glitch.
    expect(screen.getByText(zh.itemsProcessedNote)).toBeDefined()
    view.unmount()
  })

  it('expands the dossier with everything the session learned about the item', async () => {
    const { view, setDraft } = mountLens(journeyBlocks())
    const row = toggleOf()
    expect(row).toBeDefined()
    fireEvent.click(row!)
    expect(screen.getByText('a personal note')).toBeDefined()
    expect(screen.getByText('the claim')).toBeDefined()
    expect(screen.getByText('/tmp/a.pdf')).toBeDefined()
    // The dossier carries only aggregated facts — export artifacts and the
    // per-call replay live on their own lenses, never duplicated here.
    expect(screen.queryByText(/@book\{x1,/)).toBeNull()
    fireEvent.click(screen.getByText(zh.askAboutItem))
    expect(setDraft).toHaveBeenCalledWith(zh.askTemplate.replace('{ref}', REF))
    view.unmount()
  })

  it('keeps the line-end actions without a composer face', () => {
    const corpus = buildCorpus(journeyBlocks())
    const view = render(<ZoteroItemsLens corpus={corpus} t={t} />)
    expect(screen.queryByText(zh.askAboutItem)).toBeNull()
    // Copy ref stays reachable even where there is no composer to prefill.
    expect(screen.getAllByLabelText(zh.copyRef).length).toBeGreaterThan(0)
    view.unmount()
  })

  it('marks a running item row and an errored one', () => {
    const errorGet = settled({
      seq: 1,
      callId: 'g',
      call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
      isError: true,
      error: { name: 'Error', code: 'ZOTERO_UNAVAILABLE' },
      content: [],
    })
    const runningGet: RunningToolCall = {
      callId: 'r2',
      name: 'zotero_get',
      argsRaw: `{"ref":"zotero://user/0/item/EEEE2222"}`,
      turn: 1,
      step: 1,
      time: 1,
      callView: null,
      subCalls: [],
    }
    const { view } = mountLens([errorGet], [runningGet])
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(document.querySelector('[data-dot="error"]')).not.toBeNull()
    view.unmount()
  })

  it('renders url attachments in the dossier', () => {
    const blocks = [
      settled({
        seq: 1,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          total: 1,
          items: [
            { ref: 'plain-ref-1', title: 'Loose item', creatorSummary: 'C', itemType: 'report' },
          ],
        },
      }),
      settled({
        seq: 2,
        callId: 'a',
        call: { name: 'zotero_attachment', argsRaw: '{"ref":"plain-ref-1"}' },
        meta: { kind: 'url', title: 'link', contentType: 'text/html', url: 'https://example.com' },
      }),
    ]
    const { view } = mountLens(blocks)
    fireEvent.click(toggleOf()!)
    expect(screen.getByText(zh.linkedUrl)).toBeDefined()
    expect(screen.getByText('https://example.com')).toBeDefined()
    view.unmount()
  })

  it('shows the plain caption when every hit is listed', () => {
    const { view } = mountLens([
      settled({
        seq: 1,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          returned: 3,
          total: 12,
          displayed: 3,
          omitted: 0,
          items: [
            { ref: REF, title: 'One', creatorSummary: 'A', itemType: 'report' },
            {
              ref: 'zotero://user/0/item/BBBB0002',
              title: 'Two',
              creatorSummary: 'B',
              itemType: 'report',
            },
            {
              ref: 'zotero://user/0/item/CCCC0003',
              title: 'Three',
              creatorSummary: 'C',
              itemType: 'report',
            },
          ],
        },
      }),
    ])
    expect(screen.getByText(zh.itemsSourceNote.replace('{count}', '3'))).toBeDefined()
    expect(screen.queryByText(/处列出前/)).toBeNull()
    view.unmount()
  })

  it('states the honest boundary when the found set was projected partially', () => {
    const { view } = mountLens([
      settled({
        seq: 1,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          returned: 3,
          total: 12,
          displayed: 1,
          omitted: 2,
          items: [{ ref: REF, title: 'One', creatorSummary: 'A', itemType: 'report' }],
        },
      }),
    ])
    expect(
      screen.getByText(zh.itemsSourceOmittedNote.replace('{count}', '3').replace('{shown}', '1')),
    ).toBeDefined()
    view.unmount()
  })

  it('never invites an empty expansion for searched-only rows', () => {
    const { view, setDraft } = mountLens([
      settled({
        seq: 1,
        callId: 's',
        call: { name: 'zotero_search', argsRaw: '{}' },
        meta: {
          returned: 1,
          total: 1,
          displayed: 1,
          omitted: 0,
          items: [
            { ref: REF, title: 'Loose hit', creatorSummary: 'C', year: 2020, itemType: 'report' },
          ],
        },
      }),
    ])
    // No toggle: the row is a plain line with the actions at its end.
    expect(toggleOf()).toBeUndefined()
    fireEvent.click(screen.getByText(zh.askAboutItem))
    expect(setDraft).toHaveBeenCalledWith(zh.askTemplate.replace('{ref}', REF))
    view.unmount()
  })

  it('omits the caption when nothing came from a search', () => {
    const { view } = mountLens([
      settled({
        seq: 1,
        callId: 'g',
        call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
        meta: { title: 'Direct read', creators: 'A', notesPreview: [], annotationsPreview: [] },
      }),
    ])
    expect(screen.getByText('Direct read')).toBeDefined()
    expect(screen.queryByText(/检索命中/)).toBeNull()
    view.unmount()
  })

  it('lists only the worked-on target when a search hit several', () => {
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
            { ref: REF, title: 'The target', creatorSummary: 'C', itemType: 'report' },
            {
              ref: 'zotero://user/0/item/BBBB0002',
              title: 'An incidental hit',
              creatorSummary: 'D',
              itemType: 'report',
            },
          ],
        },
      }),
      settled({
        seq: 2,
        callId: 'g',
        call: { name: 'zotero_get', argsRaw: `{"ref":"${REF}"}` },
        meta: { title: 'The target', creators: 'C', notesPreview: [], annotationsPreview: [] },
      }),
    ])
    // The incidental hit disappears; only the worked-on target remains,
    // explained by the processed caption.
    expect(screen.getByText('The target')).toBeDefined()
    expect(screen.queryByText('An incidental hit')).toBeNull()
    expect(screen.getByText(zh.itemsProcessedNote)).toBeDefined()
    expect(screen.getAllByLabelText(zh.copyRef)).toHaveLength(1)
    view.unmount()
    void setDraft
  })

  it('shows the empty note over an empty corpus', () => {
    const { view } = mountLens([])
    expect(screen.getByText(zh.itemsEmptyNote)).toBeDefined()
    view.unmount()
  })
})
