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
import { badgesOf } from '../../src/client/components/workspace/SourceListItem.tsx'
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
