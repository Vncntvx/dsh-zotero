// @vitest-environment jsdom
/**
 * The source row and its dossier: provable fact badges, dossier visibility,
 * copy feedback, expansion, prefills, and the dossier sections.
 * @module tests/client/SourceRow
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zh } from '../../src/client/locales.ts'
import { CopyButton } from '../../src/client/components/CopyButton.tsx'
import { ZoteroOpenButton } from '../../src/client/components/open/ZoteroOpenButton.tsx'
import { badgesOf } from '../../src/client/components/workspace/SourceListItem.tsx'
import { sourceOf } from './helpers/source-fixtures.ts'

// The real primitives bundle pulls heavy dependencies (katex, shiki, the
// portal machinery); the row only needs the shared DOM face.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { primitivesStub } = await import('./helpers/primitives-stub.ts')
  return primitivesStub()
})

import { mockT } from './helpers/mock-translate.ts'
import { writeClipboardSpy } from './helpers/primitives-stub.ts'

const t = mockT
const writeClipboard = await writeClipboardSpy()

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('badgesOf', () => {
  it('returns nothing for a bare source', () => {
    expect(badgesOf(sourceOf({}), t)).toEqual([])
  })

  it('flags a mismatching instance under the issues badge', () => {
    expect(badgesOf(sourceOf({ evidenceMatch: 'mismatch' }), t)).toEqual([zh.issuesBadge])
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

  it('badges a resolved web PDF like a file PDF', () => {
    expect(
      badgesOf(
        sourceOf({
          attachment: {
            kind: 'url',
            contentType: 'application/pdf',
            title: 'p',
            location: 'https://e.org/p.pdf',
          },
        }),
        t,
      ),
    ).toEqual([zh.badgePdf])
  })

  it('badges a PDF hint and stays silent for a type-less ref of an older session', () => {
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
    ).toEqual([])
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

describe('CopyButton', () => {
  it('copies the value, shows the caller label, and swaps to the copied label briefly', async () => {
    vi.useFakeTimers()
    render(<CopyButton value="zotero://user/0/item/A" label={zh.copyRef} copiedLabel={zh.copied} />)
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    expect(writeClipboard).toHaveBeenCalledWith('zotero://user/0/item/A')
    // The copied flag lands on the clipboard promise, not on the click.
    await act(async () => {})
    expect(screen.getByText(zh.copied)).toBeDefined()
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    vi.useRealTimers()
  })

  it('stays on the action label when the clipboard write is denied', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(false)
    render(<CopyButton value="x" label={zh.copyRef} copiedLabel={zh.copied} />)
    fireEvent.click(screen.getByRole('button'))
    await act(async () => {})
    expect(screen.getByText(zh.copyRef)).toBeDefined()
    expect(screen.queryByText(zh.copied)).toBeNull()
    vi.useRealTimers()
  })

  it('ignores a stale clipboard resolution after a newer click', async () => {
    let resolveFirst!: (ok: boolean) => void
    let resolveSecond!: (ok: boolean) => void
    vi.mocked(writeClipboard)
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveSecond = resolve)))
    render(<CopyButton value="x" label={zh.copyRef} copiedLabel={zh.copied} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    // The first click resolves late with success, but its epoch is stale:
    // the flag must not flip for it.
    resolveFirst(true)
    await act(async () => {})
    expect(screen.queryByText(zh.copied)).toBeNull()
    // The second click's own resolution still earns the feedback.
    resolveSecond(true)
    await act(async () => {})
    expect(screen.getByText(zh.copied)).toBeDefined()
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
    // Protocol links hand to the OS handler in place per the harness
    // `renderSafeLink` contract: no blank tab, no external rel.
    expect(anchor.getAttribute('target')).toBeNull()
    expect(anchor.getAttribute('rel')).toBeNull()
    expect(anchor.getAttribute('title')).toBeNull()
    // Leading destination glyph per the clickable-link spec.
    const link = anchor.closest('a') ?? anchor
    expect(link.querySelector('[data-icon="link"]')).not.toBeNull()
  })

  it('opens http targets in a new tab with the safe rel', () => {
    render(
      <ZoteroOpenButton
        url="https://example.com/a.pdf"
        verdict="open"
        label={zh.openInZotero}
        t={t}
      />,
    )
    const anchor = screen.getByText(zh.openInZotero)
    expect(anchor.getAttribute('target')).toBe('_blank')
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
