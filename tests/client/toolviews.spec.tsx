/**
 * The five Zotero tool cards: pending/success/error states, structured
 * bodies, the degraded fallback, keyboard expansion, DOM discipline (no
 * nested interactive controls), and the export HTML-safety rule — driven
 * through direct props with frozen-block fixtures.
 * @module tests/client/toolviews.client
 */
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ZoteroAttachmentRow,
  ZoteroExportRow,
  ZoteroGetRow,
  ZoteroRetrieveRow,
  ZoteroSearchRow,
} from '../../src/client/ZoteroToolViews.tsx'
import { zh } from '../../src/client/locales.ts'
import { interpolate } from '../../src/client/presenters.ts'
import { ZoteroToolRow } from '../../src/client/ZoteroToolRow.tsx'
import { running as blocksRunning, settled as blocksSettled } from './helpers/blocks.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  // Stub the primitives surface the cards render; importing the real bundle
  // would drag katex CSS through Node's loader (see tests/client/setup.ts).
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

/** Framework-seat double: namespace dictionary first, common vocabulary falls back to the raw key. */
const t: TranslateNS<'zotero'> = (key) => (key in zh ? zh[key as keyof typeof zh] : key)

const SEARCH_VIEW: ToolCallView = {
  card: 'generic',
  title: 'Search Zotero library',
  rawInput: 'attention',
}

function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return blocksRunning({ argsRaw: '{"query":"attention"}', callView: SEARCH_VIEW, ...overrides })
}

function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return blocksSettled({
    call: { name: 'zotero_search', argsRaw: '{"query":"attention"}' },
    callView: SEARCH_VIEW,
    ...overrides,
  })
}

const SEARCH_META = {
  returned: 6,
  total: 42,
  displayed: 6,
  omitted: 0,
  items: [
    {
      ref: 'zotero://user/0/item/AAAAAAA1',
      title: 'FlashAttention-2',
      creatorSummary: 'Dao',
      year: 2023,
      itemType: 'conferencePaper',
    },
    {
      ref: 'zotero://user/0/item/AAAAAAA2',
      title: 'FlashAttention',
      creatorSummary: 'Dao',
      year: 2022,
      itemType: 'conferencePaper',
    },
  ],
}

afterEach(cleanup)

describe('ZoteroToolRow', () => {
  it('toggles on click and Enter/Space with aria-expanded and no nested controls', () => {
    const view = render(
      <ZoteroToolRow
        state="ok"
        title="Title"
        summary="Summary"
        icon={<span>i</span>}
        expandable
        inspectLabel={t('inspectLabel')}
        runningLabel={t('checking')}
        errorLabel={t('statusUnavailable')}
        stoppedLabel={t('statusUnavailable')}
      >
        <button type="button" data-testid="inner">
          inner action
        </button>
      </ZoteroToolRow>,
    )
    const row = screen.getByRole('button')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    // The inner control sits in the body, outside the toggle button.
    expect(screen.getByTestId('inner').closest('[role="button"]')).toBeNull()
    fireEvent.keyDown(row, { key: ' ' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    view.unmount()
  })

  it('keeps non-expandable rows inert and renders stopped/error states', () => {
    const inert = render(
      <ZoteroToolRow
        state="error"
        title="E"
        summary="S"
        icon={<span>i</span>}
        expandable={false}
        inspectLabel="Inspect"
        runningLabel="Running"
        errorLabel="Error"
        stoppedLabel="Stopped"
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.keyDown(inert.container.querySelector('[data-tool="zotero"]')!, { key: 'Enter' })
    expect(screen.queryByRole('button')).toBeNull()
    inert.unmount()

    const dot = render(
      <ZoteroToolRow
        state="stopped"
        title="S"
        summary="S"
        icon={<span>i</span>}
        expandable={false}
        inspectLabel="Inspect"
        runningLabel="Running"
        errorLabel="Error"
        stoppedLabel="Stopped"
      />,
    )
    expect(screen.getByText('Stopped')).toBeDefined()
    dot.unmount()

    const stopped = render(
      <ZoteroToolRow
        state="stopped"
        title="S"
        summary="S"
        icon={<span>i</span>}
        expandable
        inspectLabel="Inspect"
        runningLabel="Running"
        errorLabel="Error"
        stoppedLabel="Stopped"
      />,
    )
    expect(screen.getByText('Stopped')).toBeDefined()
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Escape' })
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    stopped.unmount()
  })

  it('marks running rows busy for assistive tech', () => {
    const view = render(
      <ZoteroToolRow
        state="running"
        title="T"
        summary="S"
        icon={<span>i</span>}
        expandable={false}
        inspectLabel="Inspect"
        runningLabel="Running"
        errorLabel="Error"
        stoppedLabel="Stopped"
      />,
    )
    expect(screen.getByText('Running')).toBeDefined()
    expect(view.container.querySelector('[data-tool="zotero"]')?.getAttribute('aria-busy')).toBe(
      'true',
    )
    view.unmount()
  })

  it('offers Inspect in the expanded body and reports the click', () => {
    const inspect = vi.fn()
    const view = render(
      <ZoteroToolRow
        state="ok"
        title="T"
        summary="S"
        icon={<span>i</span>}
        expandable
        inspect={inspect}
        inspectLabel={t('inspectLabel')}
        runningLabel={t('checking')}
        errorLabel={t('statusUnavailable')}
        stoppedLabel={t('statusUnavailable')}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText(t('inspectLabel')).closest('button')!)
    expect(inspect).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})

describe('ZoteroSearchRow', () => {
  it('renders the pending query and scope facts', () => {
    render(<ZoteroSearchRow block={running()} t={t} />)
    expect(screen.getByText(zh.tagSearch)).toBeDefined()
    expect(screen.getByText('attention')).toBeDefined()
    expect(screen.getByText('Personal library · Metadata')).toBeDefined()
  })

  it('renders the settled rows with a copyable ref and the result title', () => {
    render(
      <ZoteroSearchRow
        block={settled({
          meta: SEARCH_META,
          resultView: {
            card: 'generic',
            title: 'Zotero search: found 6 of 42 results',
          } satisfies ToolResultView,
        })}
        t={t}
      />,
    )
    expect(screen.getByText('Zotero search: found 6 of 42 results')).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/FlashAttention-2 · Dao · 2023 · conferencePaper/)).toBeDefined()
    expect(screen.getAllByText(t('copy')).length).toBe(2)
  })

  it('renders the kind tag as the leading identity and swaps its tone on failures', () => {
    const ok = render(<ZoteroSearchRow block={settled({ meta: SEARCH_META })} t={t} />)
    const tag = ok.container.querySelector('[data-kind="search"]')
    expect(tag?.textContent).toBe(zh.tagSearch)
    expect(tag?.getAttribute('data-state')).toBe('ok')
    // The card leads with the chip, never the wire tool icon (the expand
    // chevron stays, hidden until the row hover).
    expect(ok.container.querySelector('[data-icon="search"]')).toBeNull()
    expect(ok.container.querySelector('[data-icon="browse"]')).toBeNull()
    ok.unmount()

    const failed = render(
      <ZoteroSearchRow
        block={settled({
          isError: true,
          error: { name: 'ZoteroError', code: 'ZOTERO_INVALID_ARGUMENT' },
        })}
        t={t}
      />,
    )
    expect(failed.container.querySelector('[data-kind="search"]')?.getAttribute('data-state')).toBe(
      'error',
    )
    failed.unmount()
  })

  it('degrades to the content text when meta is absent and shows the mismatch guidance', () => {
    const failed = settled({
      isError: true,
      error: { name: 'ZoteroError', code: 'ZOTERO_SERVER_MISMATCH' },
      content: [{ type: 'text', text: 'The active Zotero database changed.' }],
    })
    render(<ZoteroSearchRow block={failed} t={t} />)
    expect(screen.getByText(/The active Zotero database changed/)).toBeDefined()
    expect(screen.getByText(/此 ref 属于另一个 Zotero 数据库/)).toBeDefined()
  })

  it('replays interrupted calls as stopped rows with the reason in the body', () => {
    render(
      <ZoteroSearchRow
        block={settled({ isError: true, error: { name: 'Interrupted', code: 'interrupted' } })}
        t={t}
      />,
    )
    expect(screen.getByText(t('statusUnavailable'))).toBeDefined()
    const row = screen.getByRole('button')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(row)
    expect(screen.getByText('Interrupted: interrupted')).toBeDefined()
  })

  it('falls back to Browse without args and encodes every scope kind', () => {
    const browse = render(<ZoteroSearchRow block={running({ argsRaw: '{}' })} t={t} />)
    expect(screen.getByText(t('browse'))).toBeDefined()
    expect(screen.getByText(t('scopeLibraryMetadata'))).toBeDefined()
    browse.unmount()

    const malformed = render(<ZoteroSearchRow block={running({ argsRaw: 'nope' })} t={t} />)
    expect(screen.getByText(t('browse'))).toBeDefined()
    expect(screen.queryByText(t('scopeLibraryMetadata'))).toBeNull()
    malformed.unmount()

    const everything = render(
      <ZoteroSearchRow block={running({ argsRaw: '{"mode":"everything","query":"x"}' })} t={t} />,
    )
    expect(screen.getByText(t('scopeLibraryEverything'))).toBeDefined()
    everything.unmount()

    const collection = render(
      <ZoteroSearchRow
        block={running({
          argsRaw: '{"query":"q","scope":{"kind":"collection","refOrName":"papers"}}',
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/papers/)).toBeDefined()
    collection.unmount()

    const saved = render(
      <ZoteroSearchRow
        block={running({
          argsRaw: '{"query":"q","scope":{"kind":"savedSearch","refOrName":"recent"}}',
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/recent/)).toBeDefined()
    saved.unmount()
  })

  it('summarizes counts without a result title and lists omitted extras', () => {
    render(
      <ZoteroSearchRow
        block={settled({
          meta: {
            displayed: 2,
            omitted: 3,
            items: [
              {
                ref: 'zotero://user/0/item/AAAAAAA3',
                title: 'Plain row',
                creatorSummary: '',
                itemType: 'journalArticle',
              },
            ],
          },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(interpolate(t('resultsCount'), { count: 2 }))).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(interpolate(t('moreOmitted'), { count: 3 }))).toBeDefined()
  })

  it('hands the full durable output over once the projection omits rows', () => {
    render(
      <ZoteroSearchRow
        block={settled({
          meta: {
            displayed: 1,
            omitted: 2,
            items: [
              {
                ref: 'zotero://user/0/item/AAAAAAA3',
                title: 'Only row',
                creatorSummary: '',
                itemType: 'journalArticle',
              },
            ],
          },
          content: [
            { type: 'text', text: 'Found 3 of 3 results:\n1. Full row (2023) [journalArticle]' },
          ],
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/Found 3 of 3 results/)).toBeDefined()
    expect(screen.queryByText(t('copy'))).toBeNull()
  })
})

describe('CopyValue (search rows)', () => {
  beforeEach(() => {
    vi.mocked(writeClipboard).mockClear()
    vi.mocked(writeClipboard).mockResolvedValue(true)
  })

  it('copies the ref and flips the label for the feedback window', async () => {
    render(<ZoteroSearchRow block={settled({ meta: SEARCH_META })} t={t} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getAllByText(t('copy'))[0]!.closest('button')!)
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/AAAAAAA1')
    expect(await screen.findByText(t('copied'))).toBeDefined()
  })

  it('keeps the copy label when the clipboard refuses', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(false)
    render(<ZoteroSearchRow block={settled({ meta: SEARCH_META })} t={t} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getAllByText(t('copy'))[0]!.closest('button')!)
    await act(async () => {})
    expect(writeClipboard).toHaveBeenCalled()
    expect(screen.queryAllByText(t('copied'))).toHaveLength(0)
  })

  it('resets the copied label after the feedback window', async () => {
    vi.useFakeTimers()
    try {
      render(<ZoteroSearchRow block={settled({ meta: SEARCH_META })} t={t} />)
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getAllByText(t('copy'))[0]!.closest('button')!)
      await act(async () => {})
      expect(screen.getAllByText(t('copied')).length).toBeGreaterThan(0)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(screen.queryAllByText(t('copied'))).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ZoteroGetRow', () => {
  const GET_META = {
    title: 'FlashAttention-2',
    creators: 'Dao, Tri; Smith, Jane',
    year: 2023,
    venue: 'ICLR',
    bestAttachmentContentType: 'application/pdf',
    notes: { total: 2, returned: 2 },
    annotations: { total: 17, returned: 17 },
    notesPreview: [{ ref: 'zotero://user/0/item/NOTE0001', preview: 'my note' }],
    annotationsPreview: [
      { ref: 'zotero://user/0/annotation/ANN000001', preview: 'highlight', pageLabel: '7' },
    ],
  }

  it('renders the pending ref key', () => {
    render(
      <ZoteroGetRow
        block={running({
          name: 'zotero_get',
          argsRaw: '{"ref":"zotero://user/0/item/ABCD1234"}',
          callView: {
            card: 'generic',
            title: 'Read Zotero item',
            rawInput: 'zotero://user/0/item/ABCD1234',
          },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/ABCD1234/)).toBeDefined()
  })

  it('renders the header facts and keeps personal previews labeled apart from metadata', () => {
    render(<ZoteroGetRow block={settled({ meta: GET_META })} t={t} />)
    expect(screen.getByText(/FlashAttention-2/)).toBeDefined()
    expect(screen.getByText(/Dao, Tri; Smith, Jane · 2023 · ICLR/)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByText(t('personalNotes')).length).toBeGreaterThan(0)
    expect(screen.getByText(/my note/)).toBeDefined()
    expect(screen.getByText(/highlight/)).toBeDefined()
    expect(screen.getByText(/p\.7/)).toBeDefined()
  })

  it('degrades to the content text when meta is absent', () => {
    render(
      <ZoteroGetRow
        block={settled({ content: [{ type: 'text', text: 'raw detail text' }] })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/raw detail text/)).toBeDefined()
  })

  it('expands for annotations alone and stays closed without a body', () => {
    const annotationsOnly = render(
      <ZoteroGetRow
        block={settled({
          meta: {
            title: 'T',
            annotationsPreview: [{ ref: 'zotero://user/0/annotation/ANN000001', preview: 'a' }],
          },
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    // The group header and the per-preview label both carry the annotations caption.
    expect(screen.getAllByText(t('personalAnnotations')).length).toBeGreaterThan(0)
    annotationsOnly.unmount()

    const notesOnly = render(
      <ZoteroGetRow
        block={settled({
          meta: {
            title: 'T',
            notesPreview: [{ ref: 'zotero://user/0/item/NOTE0001', preview: 'n' }],
          },
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByText(t('personalNotes')).length).toBeGreaterThan(0)
    expect(screen.queryByText(t('personalAnnotations'))).toBeNull()
    notesOnly.unmount()

    const closed = render(<ZoteroGetRow block={settled({})} t={t} />)
    expect(screen.queryByRole('button')).toBeNull()
    closed.unmount()
  })

  it('hands the full durable output over once the previews fall short of the totals', () => {
    render(
      <ZoteroGetRow
        block={settled({
          meta: {
            title: 'T',
            notes: { total: 5, returned: 5 },
            notesPreview: [{ ref: 'zotero://user/0/item/NOTE0001', preview: 'only one' }],
          },
          content: [{ type: 'text', text: 'full notes text\nsecond note' }],
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/full notes text/)).toBeDefined()
    expect(screen.queryByText(t('personalNotes'))).toBeNull()
  })
})

describe('ZoteroRetrieveRow', () => {
  const RETRIEVE_META = {
    count: 4,
    truncated: true,
    sources: ['annotation', 'note', 'fulltext'],
    items: [
      {
        source: 'annotation',
        sourceRef: 'zotero://user/0/annotation/ANN000001',
        preview: 'memory claim',
        previewTruncated: false,
        pageLabel: '7',
      },
      {
        source: 'fulltext',
        sourceRef: 'zotero://user/0/item/ABCDEFGH',
        preview: 'the paper body',
        previewTruncated: true,
      },
    ],
  }

  it('renders the pending query and ref key', () => {
    render(
      <ZoteroRetrieveRow
        block={running({
          name: 'zotero_retrieve',
          argsRaw: '{"ref":"zotero://user/0/item/ABCD1234","query":"memory efficiency"}',
          callView: { card: 'generic', title: 'Finding evidence', rawInput: 'memory efficiency' },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/memory efficiency/)).toBeDefined()
  })

  it('renders the evidence passages with per-source labels and honest page labels', () => {
    render(<ZoteroRetrieveRow block={settled({ meta: RETRIEVE_META })} t={t} />)
    expect(screen.getByText('4 evidence passages')).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/Annotation · p\.7/)).toBeDefined()
    // The fulltext row never shows a page label.
    const fulltextHead = screen.getByText(/Full text/).textContent ?? ''
    expect(fulltextHead).not.toContain('p.')
    expect(screen.getByText(/memory claim/)).toBeDefined()
    expect(screen.getByText(t('truncatedMore'))).toBeDefined()
  })

  it('expands evidence rows and labels every source kind', () => {
    render(
      <ZoteroRetrieveRow
        block={settled({
          meta: {
            count: 3,
            items: [
              {
                source: 'note',
                sourceRef: 'zotero://user/0/item/NOTE0001',
                preview: 'a note',
                previewTruncated: false,
              },
              {
                source: 'abstract',
                sourceRef: 'plain abstract ref',
                preview: 'an abstract',
                previewTruncated: false,
              },
              {
                source: 'mystery',
                sourceRef: 'zotero://user/0/item/ABCDEFGH',
                preview: 'unknown source',
                previewTruncated: false,
              },
            ],
          },
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(t('sourceNote'))).toBeDefined()
    expect(screen.getByText(t('sourceAbstract'))).toBeDefined()
    // Unknown kinds fall back to the full-text label; non-zotero refs display verbatim.
    expect(screen.getAllByText(t('sourceFulltext'))).toHaveLength(1)
    expect(screen.getByText('plain abstract ref')).toBeDefined()
    // The long ref stays available as the code element's title attribute.
    expect(screen.getByText('NOTE0001').getAttribute('title')).toBe('zotero://user/0/item/NOTE0001')
    expect(screen.queryByText('▾')).toBeNull()
    const expander = screen.getAllByRole('button')[1]!
    expect(expander.getAttribute('aria-expanded')).toBe('false')
    expect(expander.getAttribute('aria-label')).toBe(t('evidenceExpandLabel'))
    fireEvent.click(expander)
    expect(expander.getAttribute('aria-expanded')).toBe('true')
    expect(expander.getAttribute('aria-label')).toBe(t('evidenceCollapseLabel'))
    expect(screen.getAllByText('▾')).toHaveLength(1)
    fireEvent.click(expander)
    expect(screen.getAllByText('▸')).toHaveLength(3)
  })

  it('degrades the pending summary without args and quotes the query when present', () => {
    const noArgs = render(
      <ZoteroRetrieveRow block={running({ name: 'zotero_retrieve', argsRaw: 'nope' })} t={t} />,
    )
    expect(screen.getByText(t('browse'))).toBeDefined()
    expect(screen.queryByText(/ABCD/)).toBeNull()
    noArgs.unmount()

    const noQuery = render(
      <ZoteroRetrieveRow
        block={running({
          name: 'zotero_retrieve',
          argsRaw: '{"ref":"zotero://user/0/item/ABCD1234"}',
        })}
        t={t}
      />,
    )
    expect(screen.getByText(t('browse'))).toBeDefined()
    expect(screen.getByText('ABCD1234')).toBeDefined()
    noQuery.unmount()

    const quoted = render(
      <ZoteroRetrieveRow
        block={running({ name: 'zotero_retrieve', argsRaw: '{"query":"attention"}' })}
        t={t}
      />,
    )
    expect(screen.getByText('"attention"')).toBeDefined()
    quoted.unmount()
  })

  it('falls back to titles and the content body without meta projections', () => {
    const titled = render(
      <ZoteroRetrieveRow
        block={settled({ resultView: { card: 'generic', title: 'Evidence found' } })}
        t={t}
      />,
    )
    expect(screen.getByText('Evidence found')).toBeDefined()
    titled.unmount()

    const plain = render(<ZoteroRetrieveRow block={settled({})} t={t} />)
    expect(screen.getByText(t('toolRetrieveTitle'))).toBeDefined()
    plain.unmount()

    const noSources = render(
      <ZoteroRetrieveRow block={settled({ meta: { count: 3, items: [] } })} t={t} />,
    )
    expect(screen.getByText(interpolate(t('evidencePassages'), { count: 3 }))).toBeDefined()
    expect(screen.queryByText(/sources:/)).toBeNull()
    noSources.unmount()

    render(
      <ZoteroRetrieveRow
        block={settled({ content: [{ type: 'text', text: 'raw evidence' }] })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('raw evidence')).toBeDefined()
  })

  it('hands the full durable output over once the retrieval truncated', () => {
    render(
      <ZoteroRetrieveRow
        block={settled({
          meta: {
            count: 2,
            truncated: true,
            sourcesSkipped: ['fulltext'],
            items: [
              {
                source: 'annotation',
                sourceRef: 'zotero://user/0/annotation/ANN000001',
                preview: 'first',
                previewTruncated: false,
                pageLabel: '7',
              },
            ],
          },
          content: [{ type: 'text', text: 'all passages:\n1. one\n2. two' }],
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/all passages/)).toBeDefined()
    expect(screen.queryByText(t('truncatedMore'))).toBeNull()
  })
})

describe('ZoteroAttachmentRow', () => {
  it('renders the pending ref key', () => {
    render(
      <ZoteroAttachmentRow
        block={running({
          name: 'zotero_attachment',
          argsRaw: '{"ref":"zotero://user/0/item/ABCD1234"}',
          callView: {
            card: 'generic',
            title: 'Resolve Zotero attachment',
            rawInput: 'zotero://user/0/item/ABCD1234',
          },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/ABCD1234/)).toBeDefined()
  })

  it('renders the file location without making the long path primary', () => {
    render(
      <ZoteroAttachmentRow
        block={settled({
          meta: {
            kind: 'file',
            title: 'FlashAttention-2.pdf',
            contentType: 'application/pdf',
            path: '/Users/xu/Zotero/storage/ABCD1234/FlashAttention-2.pdf',
          },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/FlashAttention-2\.pdf/)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    const path = screen.getByText(/\/Users\/xu\/Zotero/)
    expect(path.getAttribute('title')).toBe(
      '/Users/xu/Zotero/storage/ABCD1234/FlashAttention-2.pdf',
    )
    expect(screen.getByText(t('copy'))).toBeDefined()
  })

  it('renders linked URLs without a content type and degrades to the content body', () => {
    const url = render(
      <ZoteroAttachmentRow
        block={settled({
          meta: { kind: 'url', title: 'FlashAttention.pdf', url: 'https://example.org/paper.pdf' },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(t('linkedUrl'))).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('https://example.org/paper.pdf')).toBeDefined()
    url.unmount()

    const degraded = render(
      <ZoteroAttachmentRow
        block={settled({ content: [{ type: 'text', text: 'attachment detail' }] })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('attachment detail')).toBeDefined()
    degraded.unmount()
  })
})

describe('ZoteroExportRow', () => {
  it('renders the pending format summary from args', () => {
    render(
      <ZoteroExportRow
        block={running({
          name: 'zotero_export',
          argsRaw:
            '{"refs":["zotero://user/0/item/AAAAAAA1","zotero://user/0/item/AAAAAAA2"],"format":"bibliography"}',
          callView: {
            card: 'generic',
            title: 'Export Zotero citations',
            rawInput: '2 refs · bibliography',
          },
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/2 refs · bibliography/)).toBeDefined()
  })

  it('counts actual citations and renders the bibliography as plain text, never HTML', () => {
    const hostile = '<div>Dao, T. (2023). <img src=x onerror=alert(1)>FlashAttention-2</div>'
    render(
      <ZoteroExportRow
        block={settled({
          meta: { format: 'bibliography', requested: 3, style: 'apa', locale: 'en-US' },
          content: [{ type: 'text', text: hostile }],
        })}
        t={t}
      />,
    )
    expect(screen.getByText(/3 refs/)).toBeDefined()
    expect(screen.getByText(/apa · en-US/)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    // The hostile markup renders as text only — no img element reaches the DOM.
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText(/FlashAttention-2/)).toBeDefined()
  })

  it('renders machine formats through a code block surface', () => {
    render(
      <ZoteroExportRow
        block={settled({
          meta: { format: 'bibtex', requested: 1 },
          content: [{ type: 'text', text: '@article{flash, title={FlashAttention-2}}' }],
        })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/@article\{flash/)).toBeDefined()
  })

  it('renders the pending summary from absent args without crashing', () => {
    render(<ZoteroExportRow block={running({ name: 'zotero_export', argsRaw: '{}' })} t={t} />)
    expect(screen.getByText(zh.tagExport)).toBeDefined()
  })

  it('counts citation requests and falls back to result and tool titles', () => {
    const cited = render(
      <ZoteroExportRow
        block={settled({ meta: { format: 'citation', count: 5, style: 'apa' } })}
        t={t}
      />,
    )
    expect(screen.getByText(interpolate(t('citationsCount'), { count: 5 }))).toBeDefined()
    cited.unmount()

    const titled = render(
      <ZoteroExportRow
        block={settled({ resultView: { card: 'generic', title: 'Export done' } })}
        t={t}
      />,
    )
    expect(screen.getByText('Export done')).toBeDefined()
    titled.unmount()

    const fallback = render(<ZoteroExportRow block={settled({})} t={t} />)
    expect(screen.getByText(t('toolExportTitle'))).toBeDefined()
    fallback.unmount()
  })

  it('routes every machine format through the code surface', () => {
    for (const [format, code] of [
      ['biblatex', '@book{x}'],
      ['ris', 'TY - JOUR'],
      ['json', '{"refs":[]}'],
    ] as const) {
      const view = render(
        <ZoteroExportRow
          block={settled({ meta: { format }, content: [{ type: 'text', text: code }] })}
          t={t}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      // The highlighted surface splits tokens across spans; match on joined text.
      expect(
        screen.getAllByText((_, el) => el?.textContent?.includes(code) === true).length,
      ).toBeGreaterThan(0)
      view.unmount()
    }
  })

  it('caps long bibliographies and tolerates a body-less parser result', () => {
    const long = 'x'.repeat(601)
    const capped = render(
      <ZoteroExportRow
        block={settled({ meta: { format: 'citation' }, content: [{ type: 'text', text: long }] })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(`${'x'.repeat(600)}…`)).toBeDefined()
    capped.unmount()

    const OriginalDOMParser = globalThis.DOMParser
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString() {
          return { body: { textContent: null } }
        }
      },
    )
    try {
      const stub = render(
        <ZoteroExportRow
          block={settled({
            meta: { format: 'bibliography' },
            content: [{ type: 'text', text: 'x' }],
          })}
          t={t}
        />,
      )
      fireEvent.click(screen.getByRole('button'))
      const pre = stub.container.querySelector('pre')
      expect(pre?.textContent).toBe('')
    } finally {
      vi.stubGlobal('DOMParser', OriginalDOMParser)
    }
  })
})
