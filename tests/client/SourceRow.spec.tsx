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
import { CopyButton } from '../../src/client/components/CopyButton.tsx'
import { ZoteroOpenButton } from '../../src/client/components/open/ZoteroOpenButton.tsx'
import { SourceRow, badgesOf, hasDossierContent } from '../../src/client/components/SourceRow.tsx'
import { sourceOf } from './helpers/source-fixtures.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    IconChevronDownOutline14: (props: Record<string, unknown>) =>
      createElement('span', { 'data-icon': 'chevron-down', ...props }),
    writeClipboard: vi.fn(async () => true),
    Tooltip: ({ children }: { children: React.ReactElement }) => children,
  }
})

const { writeClipboard } = vi.mocked(
  await vi.importMock<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(
    '@deepseek-ai/dsh-client-ui-primitives',
  ),
)

const t: TranslateNS<'zotero'> = (key) => zh[key as ZoteroLocaleKey] ?? key

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('badgesOf', () => {
  it('returns nothing for a bare source', () => {
    expect(badgesOf(sourceOf({}), t)).toEqual([])
  })

  it('flags a mismatching instance under the issues badge', () => {
    expect(badgesOf(sourceOf({ provenance: 'mismatch' }), t)).toEqual([zh.issuesBadge])
  })

  it('badges a PDF and stays silent for a resolved non-PDF attachment', () => {
    expect(
      badgesOf(
        sourceOf({
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
        sourceOf({
          attachment: {
            kind: 'url',
            contentType: 'text/html',
            title: 'p',
            location: 'https://e.org',
          },
        }),
        t,
      ),
    ).toEqual([])
  })

  it('badges a PDF attachment selection hint and an inferred type-less ref', () => {
    expect(
      badgesOf(
        sourceOf({
          bestAttachment: {
            ref: 'zotero://user/0/attachment/WXYZ6789',
            contentType: 'application/pdf',
          },
        }),
        t,
      ),
    ).toEqual([zh.badgePdf])
    expect(
      badgesOf(sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/WXYZ6789' } }), t),
    ).toEqual([zh.badgePdf])
  })

  it('stays silent for a hint without a deep-linkable ref', () => {
    expect(badgesOf(sourceOf({ bestAttachment: { contentType: 'application/pdf' } }), t)).toEqual(
      [],
    )
  })

  it('badges evidence and exports, collapsing every operation into one issues badge', () => {
    const badges = badgesOf(
      sourceOf({
        facts: {
          inspected: false,
          evidenceCount: 2,
          reportedEvidenceCount: 2,
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
      zh.issuesBadge,
    ])
  })
})

describe('hasDossierContent', () => {
  it('is false for a bare source', () => {
    expect(hasDossierContent(sourceOf({}))).toBe(false)
  })

  it('is true for every provable fact', () => {
    expect(
      hasDossierContent(
        sourceOf({
          searches: [
            { callId: 's1', mode: 'metadata', scope: { kind: 'library' }, itemTypes: [], tags: [] },
          ],
        }),
      ),
    ).toBe(true)
    expect(
      hasDossierContent(
        sourceOf({ attachment: { kind: 'file', contentType: 'x', title: '', location: '' } }),
      ),
    ).toBe(true)
    expect(
      hasDossierContent(sourceOf({ bestAttachment: { contentType: 'application/pdf' } })),
    ).toBe(true)
    expect(
      hasDossierContent(
        sourceOf({
          facts: {
            inspected: false,
            evidenceCount: 1,
            reportedEvidenceCount: 1,
            attachmentResolved: false,
            exportCount: 0,
          },
        }),
      ),
    ).toBe(true)
    expect(
      hasDossierContent(
        sourceOf({
          facts: {
            inspected: false,
            evidenceCount: 0,
            reportedEvidenceCount: 0,
            attachmentResolved: false,
            exportCount: 1,
          },
        }),
      ),
    ).toBe(true)
    expect(hasDossierContent(sourceOf({ operations: { running: 1, failed: 0, stopped: 0 } }))).toBe(
      true,
    )
    expect(hasDossierContent(sourceOf({ operations: { running: 0, failed: 1, stopped: 0 } }))).toBe(
      true,
    )
    expect(hasDossierContent(sourceOf({ operations: { running: 0, failed: 0, stopped: 1 } }))).toBe(
      true,
    )
    expect(hasDossierContent(sourceOf({ provenance: 'mismatch' }))).toBe(true)
  })
})

describe('CopyButton', () => {
  it('copies the value, shows the caller label, and swaps to the copied label briefly', () => {
    vi.useFakeTimers()
    render(<CopyButton value="zotero://user/0/item/A" label={zh.copyRef} copiedLabel={zh.copied} />)
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/A')
    expect(screen.getByText(zh.copied)).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    vi.useRealTimers()
  })
})

describe('ZoteroOpenButton', () => {
  it('renders a bare action with the shared geometry when no class is given', () => {
    render(
      <ZoteroOpenButton
        url="zotero://select/library/items/ABCDEFGH"
        verdict="open"
        label={zh.openInZotero}
        t={t}
      />,
    )
    const anchor = screen.getByText(zh.openInZotero)
    expect(anchor.getAttribute('href')).toBe('zotero://select/library/items/ABCDEFGH')
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('title')).toBeNull()
  })
})

describe('SourceRow', () => {
  const FULL: SourceItem = sourceOf({
    title: 'FlashAttention-2',
    creators: 'Dao',
    year: 2023,
    venue: 'ICLR',
    facts: {
      inspected: false,
      evidenceCount: 1,
      reportedEvidenceCount: 1,
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
        itemTypes: [],
        tags: [],
      },
    ],
    operations: { running: 1, failed: 2, stopped: 3 },
  })

  it('opens a disabled head for a bare source and an expanding one with facts', () => {
    const bare = sourceOf({})
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
    const urlItem = sourceOf({
      facts: {
        inspected: false,
        evidenceCount: 0,
        reportedEvidenceCount: 0,
        attachmentResolved: true,
        exportCount: 0,
      },
      attachment: { kind: 'url', contentType: 'text/html', title: 'p', location: 'https://e.org' },
    })
    const view = render(<SourceRow item={urlItem} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.linkedUrl)).toBeDefined()
    const urlLink = screen.getByText('https://e.org')
    expect(urlLink.getAttribute('href')).toBe('https://e.org')
    view.unmount()

    // Non-web schemes and unparseable locations stay copyable plain text.
    for (const location of ['file:///tmp/a.pdf', 'not a url']) {
      const unsafeItem = sourceOf({
        attachment: { kind: 'url', contentType: 'text/html', title: 'p', location },
      })
      const unsafeView = render(<SourceRow item={unsafeItem} t={t} />)
      fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
      expect(screen.getByText(location).tagName).toBe('P')
      unsafeView.unmount()
    }

    const hintItem = sourceOf({
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

    const hintNoRef = sourceOf({ bestAttachment: { contentType: 'application/pdf' } })
    const noRefView = render(<SourceRow item={hintNoRef} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText('application/pdf')).toBeDefined()
    noRefView.unmount()

    const hintEmpty = sourceOf({ bestAttachment: {} })
    const emptyView = render(<SourceRow item={hintEmpty} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.bestAttachmentLabel)).toBeDefined()
    emptyView.unmount()
  })

  it('joins only the non-zero operation counts in the dossier', () => {
    const failedOnly = sourceOf({ operations: { running: 0, failed: 2, stopped: 0 } })
    const failedView = render(<SourceRow item={failedOnly} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    // The badge collapses to issues; the dossier keeps the exact counts.
    expect(screen.getByText(zh.issuesBadge)).toBeDefined()
    expect(screen.getByText(/失败 2/)).toBeDefined()
    failedView.unmount()

    const runningOnly = sourceOf({ operations: { running: 1, failed: 0, stopped: 0 } })
    const runningView = render(<SourceRow item={runningOnly} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(/进行中 1/)).toBeDefined()
    runningView.unmount()
  })

  it('shows the reported-evidence line in the dossier only when it exceeds the kept previews', () => {
    const reported = sourceOf({
      facts: {
        inspected: false,
        evidenceCount: 1,
        reportedEvidenceCount: 7,
        attachmentResolved: false,
        exportCount: 0,
      },
    })
    const view = render(<SourceRow item={reported} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.reportedEvidenceInDetail.replace('{count}', '7'))).toBeDefined()
    view.unmount()

    const equal = sourceOf({
      facts: {
        inspected: false,
        evidenceCount: 1,
        reportedEvidenceCount: 1,
        attachmentResolved: false,
        exportCount: 0,
      },
    })
    render(<SourceRow item={equal} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.queryByText(zh.reportedEvidenceInDetail.replace('{count}', '1'))).toBeNull()
  })

  it('shows the mismatch warning and the operations line in the dossier', () => {
    const mismatch = sourceOf({
      provenance: 'mismatch',
      operations: { running: 1, failed: 2, stopped: 3 },
    })
    render(<SourceRow item={mismatch} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/进行中 1 · 失败 2 · 已停止 3/)).toBeDefined()
  })

  it('shows browse provenance for a search without a query', () => {
    const browse = sourceOf({
      searches: [
        { callId: 's1', mode: 'metadata', scope: { kind: 'library' }, itemTypes: [], tags: [] },
      ],
    })
    render(<SourceRow item={browse} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /zotero:\/\/user\/0\/item\/A/ }))
    expect(screen.getByText(zh.searchFromBrowse)).toBeDefined()
  })

  it('opens in Zotero and opens the PDF from the line actions', () => {
    const full = sourceOf({
      ...FULL,
      key: 'zotero://user/0/item/ABCDEFGH',
      ref: 'zotero://user/0/item/ABCDEFGH',
    })
    const view = render(<SourceRow item={full} t={t} />)
    const links = Array.from(view.container.querySelectorAll('a')).map((anchor) =>
      anchor.getAttribute('href'),
    )
    expect(links).toContain('zotero://select/library/items/ABCDEFGH')
    expect(links).toContain('zotero://open-pdf/library/items/WXYZ6789')
    view.unmount()
  })

  it('shows the pdf action exactly when a capability exists, inferred refs included', () => {
    const inferred = sourceOf({ bestAttachment: { ref: 'zotero://user/0/attachment/WXYZ6789' } })
    const view = render(<SourceRow item={inferred} t={t} />)
    expect(
      Array.from(view.container.querySelectorAll('a'))
        .map((anchor) => anchor.getAttribute('href'))
        .some((href) => href === 'zotero://open-pdf/library/items/WXYZ6789'),
    ).toBe(true)
    view.unmount()

    const noCapability = sourceOf({ bestAttachment: { contentType: 'application/pdf' } })
    const bare = render(<SourceRow item={noCapability} t={t} />)
    expect(
      Array.from(bare.container.querySelectorAll('a'))
        .map((anchor) => anchor.getAttribute('href'))
        .some((href) => href?.startsWith('zotero://open-pdf/')),
    ).toBe(false)
    bare.unmount()
  })

  it('blocks every open link for a mismatching item with focusable disabled actions', () => {
    const mismatch = sourceOf({
      key: 'zotero://user/0/item/ABCDEFGH',
      ref: 'zotero://user/0/item/ABCDEFGH',
      provenance: 'mismatch',
      bestAttachment: {
        ref: 'zotero://user/0/attachment/WXYZ6789',
        contentType: 'application/pdf',
      },
    })
    const view = render(<SourceRow item={mismatch} t={t} />)
    expect(view.container.querySelector('a')).toBeNull()
    const blocked = view.container.querySelectorAll('button[aria-disabled="true"]')
    expect(blocked.length).toBeGreaterThanOrEqual(2)
    expect(blocked[0]!.getAttribute('aria-disabled')).toBe('true')
    expect(blocked[0]!.getAttribute('disabled')).toBeNull()
    // A real activation attempt stays inert: aria-disabled blocks the action.
    fireEvent.click(blocked[0]!)
    expect(blocked[0]!.getAttribute('aria-disabled')).toBe('true')
    // The reason stays readable: the sr-only description, plus the dossier line on open.
    expect(screen.getAllByText(zh.provenanceMismatch).length).toBeGreaterThanOrEqual(1)
    view.unmount()
  })

  it('caves unverified open links with the instance note in the native title', () => {
    const unverified = sourceOf({
      key: 'zotero://user/0/item/ABCDEFGH',
      ref: 'zotero://user/0/item/ABCDEFGH',
      provenance: 'unknown',
    })
    const view = render(<SourceRow item={unverified} t={t} />)
    const anchors = Array.from(view.container.querySelectorAll('a'))
    expect(anchors.length).toBeGreaterThanOrEqual(1)
    expect(anchors.every((anchor) => anchor.getAttribute('title') === zh.instanceUnverified)).toBe(
      true,
    )
    view.unmount()
  })

  it('omits the caveat title for a verified item', () => {
    const verified = sourceOf({
      key: 'zotero://user/0/item/ABCDEFGH',
      ref: 'zotero://user/0/item/ABCDEFGH',
      provenance: 'verified',
    })
    const view = render(<SourceRow item={verified} t={t} />)
    const anchors = Array.from(view.container.querySelectorAll('a'))
    expect(anchors.length).toBeGreaterThanOrEqual(1)
    expect(anchors.every((anchor) => anchor.getAttribute('title') === null)).toBe(true)
    view.unmount()
  })
})
