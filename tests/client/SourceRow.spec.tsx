// @vitest-environment jsdom
/**
 * The source row and its dossier: provable fact badges, dossier visibility,
 * copy feedback, expansion, prefills, and the dossier sections.
 * @module tests/client/SourceRow
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceItem } from '../../src/client/sources/model.ts'
import { zh, type ZoteroLocaleKey } from '../../src/client/locales.ts'
import {
  CopyButton,
  SourceRow,
  badgesOf,
  hasDossierContent,
} from '../../src/client/components/SourceRow.tsx'

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

function itemOf(overrides: Partial<SourceItem>): SourceItem {
  return {
    key: 'zotero://user/0/item/a',
    ref: 'zotero://user/0/item/A',
    provenance: 'unknown',
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 0,
      attachmentResolved: false,
      exportCount: 0,
    },
    operations: { running: 0, failed: 0, stopped: 0 },
    searches: [],
    evidence: [],
    exports: [],
    firstSeenAt: 1,
    lastTouchedAt: 1,
    callRefs: { successful: [], failed: [], running: [] },
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('badgesOf', () => {
  it('returns nothing for a bare source', () => {
    expect(badgesOf(itemOf({}), t)).toEqual([])
  })

  it('marks a mismatching instance first', () => {
    expect(badgesOf(itemOf({ provenance: 'mismatch' }), t)).toEqual([zh.provenanceMismatch])
  })

  it('badges a resolved PDF and a resolved non-PDF attachment', () => {
    expect(
      badgesOf(
        itemOf({
          facts: {
            discovered: true,
            inspected: false,
            evidenceCount: 0,
            attachmentResolved: true,
            exportCount: 0,
          },
          attachment: {
            ref: 'zotero://user/0/attachment/WXYZ6789',
            kind: 'file',
            contentType: 'application/pdf',
            title: 'a.pdf',
            location: '/tmp/a.pdf',
          },
        }),
        t,
      ),
    ).toEqual([zh.badgePdf])
    expect(
      badgesOf(
        itemOf({
          facts: {
            discovered: true,
            inspected: false,
            evidenceCount: 0,
            attachmentResolved: true,
            exportCount: 0,
          },
          attachment: {
            kind: 'url',
            contentType: 'text/html',
            title: 'p',
            location: 'https://e.org',
          },
        }),
        t,
      ),
    ).toEqual([zh.attachmentBadge])
  })

  it('badges the attachment selection hint when nothing was resolved', () => {
    expect(badgesOf(itemOf({ bestAttachment: { contentType: 'application/pdf' } }), t)).toEqual([
      zh.badgePdf,
    ])
  })

  it('badges evidence, exports, and every operation kind', () => {
    const badges = badgesOf(
      itemOf({
        facts: {
          discovered: true,
          inspected: false,
          evidenceCount: 2,
          attachmentResolved: false,
          exportCount: 1,
        },
        operations: { running: 1, failed: 2, stopped: 3 },
      }),
      t,
    )
    expect(badges).toEqual([
      zh.evidenceBadge.replace('{count}', '2'),
      zh.exportBadge.replace('{count}', '1'),
      zh.failedBadge.replace('{count}', '2'),
      zh.runningBadge.replace('{count}', '1'),
      zh.stoppedBadge.replace('{count}', '3'),
    ])
  })
})

describe('hasDossierContent', () => {
  it('is false for a bare source', () => {
    expect(hasDossierContent(itemOf({}))).toBe(false)
  })

  it('is true for every provable fact', () => {
    expect(
      hasDossierContent(
        itemOf({
          searches: [
            {
              callId: 's1',
              mode: 'metadata',
              scope: { kind: 'library' },
              offset: 0,
              returned: 1,
              omitted: 0,
            },
          ],
        }),
      ),
    ).toBe(true)
    expect(
      hasDossierContent(
        itemOf({ attachment: { kind: 'file', contentType: 'x', title: '', location: '' } }),
      ),
    ).toBe(true)
    expect(hasDossierContent(itemOf({ bestAttachment: { contentType: 'application/pdf' } }))).toBe(
      true,
    )
    expect(
      hasDossierContent(
        itemOf({
          facts: {
            discovered: true,
            inspected: false,
            evidenceCount: 1,
            attachmentResolved: false,
            exportCount: 0,
          },
        }),
      ),
    ).toBe(true)
    expect(
      hasDossierContent(
        itemOf({
          facts: {
            discovered: true,
            inspected: false,
            evidenceCount: 0,
            attachmentResolved: false,
            exportCount: 1,
          },
        }),
      ),
    ).toBe(true)
    expect(hasDossierContent(itemOf({ operations: { running: 1, failed: 0, stopped: 0 } }))).toBe(
      true,
    )
    expect(hasDossierContent(itemOf({ operations: { running: 0, failed: 1, stopped: 0 } }))).toBe(
      true,
    )
    expect(hasDossierContent(itemOf({ operations: { running: 0, failed: 0, stopped: 1 } }))).toBe(
      true,
    )
    expect(hasDossierContent(itemOf({ provenance: 'mismatch' }))).toBe(true)
  })
})

describe('CopyButton', () => {
  it('copies the value and shows the feedback window', () => {
    vi.useFakeTimers()
    render(<CopyButton value="zotero://user/0/item/A" label={zh.copyRef} t={t} />)
    fireEvent.click(screen.getByRole('button'))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/A')
    expect(screen.getByText(zh.copied)).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByText(zh.copy)).toBeDefined()
    vi.useRealTimers()
  })
})

describe('SourceRow', () => {
  const FULL: SourceItem = itemOf({
    title: 'FlashAttention-2',
    creators: 'Dao',
    year: 2023,
    venue: 'ICLR',
    facts: {
      discovered: true,
      inspected: false,
      evidenceCount: 1,
      attachmentResolved: true,
      exportCount: 1,
    },
    attachment: {
      ref: 'zotero://user/0/attachment/WXYZ6789',
      kind: 'file',
      contentType: 'application/pdf',
      title: 'a.pdf',
      location: '/tmp/a.pdf',
    },
    searches: [
      {
        callId: 's1',
        query: 'attention',
        mode: 'metadata',
        scope: { kind: 'library' },
        offset: 0,
        returned: 1,
        omitted: 0,
      },
    ],
    operations: { running: 1, failed: 2, stopped: 3 },
  })

  it('opens a disabled head for a bare source and an expanding one with facts', () => {
    const bare = itemOf({})
    const view = render(<SourceRow item={bare} t={t} />)
    const head = screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ })
    expect(head.getAttribute('aria-expanded')).toBeNull()
    expect(head.getAttribute('disabled')).toBeDefined()
    view.unmount()

    render(<SourceRow item={FULL} t={t} setDraft={vi.fn()} />)
    const open = screen.getByRole('button', { name: /FlashAttention-2/ })
    fireEvent.click(open)
    expect(open.getAttribute('aria-expanded')).toBe('true')
    // The dossier carries the search provenance, attachment, counts, and
    // operations — and the ask prefill fires without submitting anything.
    expect(screen.getByText(zh.searchFrom.replace('{query}', 'attention'))).toBeDefined()
    expect(screen.getByText('/tmp/a.pdf')).toBeDefined()
    expect(screen.getByText(zh.evidenceInDetail.replace('{count}', '1'))).toBeDefined()
    expect(screen.getByText(zh.exportsInDetail.replace('{count}', '1'))).toBeDefined()
  })

  it('prefills the composer from the ask action and copies the ref', () => {
    const setDraft = vi.fn()
    render(<SourceRow item={FULL} t={t} setDraft={setDraft} />)
    fireEvent.click(screen.getByText(zh.askAboutItem))
    expect(setDraft).toHaveBeenCalledWith(zh.askTemplate.replace('{ref}', 'zotero://user/0/item/A'))
    fireEvent.click(screen.getByText(zh.exportCitation))
    expect(setDraft).toHaveBeenCalledWith(
      zh.citeTemplate.replace('{ref}', 'zotero://user/0/item/A'),
    )
    fireEvent.click(screen.getByLabelText(zh.copyRef))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/A')
  })

  it('renders the linked-url and attachment-hint dossier arms', () => {
    const urlItem = itemOf({
      facts: {
        discovered: true,
        inspected: false,
        evidenceCount: 0,
        attachmentResolved: true,
        exportCount: 0,
      },
      attachment: { kind: 'url', contentType: 'text/html', title: 'p', location: 'https://e.org' },
    })
    const view = render(<SourceRow item={urlItem} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.linkedUrl)).toBeDefined()
    expect(screen.getByText('https://e.org')).toBeDefined()
    view.unmount()

    const hintItem = itemOf({
      bestAttachment: {
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
      },
    })
    const hintView = render(<SourceRow item={hintItem} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.bestAttachmentLabel)).toBeDefined()
    expect(screen.getByText('zotero://user/0/attachment/WXYZ6789')).toBeDefined()
    hintView.unmount()

    const hintNoRef = itemOf({ bestAttachment: { contentType: 'application/pdf' } })
    const noRefView = render(<SourceRow item={hintNoRef} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText('application/pdf')).toBeDefined()
    noRefView.unmount()

    const hintEmpty = itemOf({ bestAttachment: {} })
    const emptyView = render(<SourceRow item={hintEmpty} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.bestAttachmentLabel)).toBeDefined()
    emptyView.unmount()
  })

  it('joins only the non-zero operation counts', () => {
    const failedOnly = itemOf({ operations: { running: 0, failed: 2, stopped: 0 } })
    const failedView = render(<SourceRow item={failedOnly} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    // The badge and the dossier line both carry the count.
    expect(
      screen.getAllByText(zh.failedBadge.replace('{count}', '2')).length,
    ).toBeGreaterThanOrEqual(2)
    failedView.unmount()

    const runningOnly = itemOf({ operations: { running: 1, failed: 0, stopped: 0 } })
    const runningView = render(<SourceRow item={runningOnly} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(
      screen.getAllByText(zh.runningBadge.replace('{count}', '1')).length,
    ).toBeGreaterThanOrEqual(2)
    runningView.unmount()
  })

  it('shows the mismatch warning and the operations line in the dossier', () => {
    const mismatch = itemOf({
      provenance: 'mismatch',
      operations: { running: 1, failed: 2, stopped: 3 },
    })
    render(<SourceRow item={mismatch} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/进行中 1 · 失败 2 · 已停止 3/)).toBeDefined()
  })

  it('shows browse provenance for a search without a query', () => {
    const browse = itemOf({
      searches: [
        {
          callId: 's1',
          mode: 'metadata',
          scope: { kind: 'library' },
          offset: 0,
          returned: 1,
          omitted: 0,
        },
      ],
    })
    render(<SourceRow item={browse} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.searchFromBrowse)).toBeDefined()
  })
})
