// @vitest-environment jsdom
/**
 * The SourceExports component: the selected source's own export documents,
 * the note that the workspace windowed its list, and the note that some
 * exports cannot be isolated to this source.
 * @module tests/client/workspace/SourceExports
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceExports } from '../../../src/client/components/workspace/SourceExports.tsx'
import { artifactOf, sourceOf } from '../helpers/source-fixtures.ts'

import { mockT } from '../helpers/mock-translate.ts'

const t = mockT

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** A source whose single export is attributable to it. */
function sourceWithOwnExport() {
  const text = '@article{a,\n  title = {A},\n}'
  return sourceOf({
    ref: 'zotero://user/0/item/QRST3456',
    exports: [
      artifactOf({
        text,
        items: [
          {
            ref: 'zotero://user/0/item/QRST3456',
            exportKey: 'a',
            title: 'Own export',
            start: 0,
            end: text.length,
          },
        ],
      }),
    ],
  })
}

describe('SourceExports component', () => {
  it('reports an empty trail when the source exported nothing', () => {
    const item = sourceOf({ exports: [] })
    render(<SourceExports item={item} t={t} />)
    expect(screen.getByText(t('exportsEmptyNote'))).toBeTruthy()
  })

  it('lists the source export without a note when everything is attributable', () => {
    const item = sourceWithOwnExport()
    render(<SourceExports item={item} t={t} />)
    expect(screen.getByText('Own export')).toBeTruthy()
    expect(screen.queryByText(t('exportsOmittedNote', { count: 1 }))).toBeNull()
    expect(screen.queryByText(t('sourceExportsIsolatedNote', { count: 1 }))).toBeNull()
  })

  it('keeps the truncation note when the workspace windowed the export list', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/QRST3456',
      exports: [artifactOf()],
      exportsTotal: 3,
    })
    render(<SourceExports item={item} t={t} />)
    expect(screen.getByText(t('exportsOmittedNote', { count: 3 }))).toBeTruthy()
  })

  it('counts the exports that cannot be isolated to the source', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/QRST3456',
      exports: [
        artifactOf(),
        // A batch body the provider could not locate per item: it carries
        // another source's entry, so it stays hidden here.
        artifactOf({
          callId: 'call-export-2',
          refs: ['zotero://user/0/item/QRST3456', 'zotero://user/0/item/OTHER123'],
          items: [{ ref: 'zotero://user/0/item/QRST3456', exportKey: 'a' }],
        }),
      ],
    })
    render(<SourceExports item={item} t={t} />)
    expect(screen.getByText(t('sourceExportsIsolatedNote', { count: 1 }))).toBeTruthy()
  })

  it('reports that no export could be isolated when the whole list drops out', () => {
    const item = sourceOf({
      ref: 'zotero://user/0/item/QRST3456',
      exports: [
        artifactOf({
          refs: ['zotero://user/0/item/QRST3456', 'zotero://user/0/item/OTHER123'],
          items: [{ ref: 'zotero://user/0/item/QRST3456', exportKey: 'a' }],
        }),
      ],
    })
    render(<SourceExports item={item} t={t} />)
    expect(screen.getByText(t('sourceExportsUnavailable'))).toBeTruthy()
  })

  it('renders page controls when a pager is provided', () => {
    const pager = {
      pages: [],
      shown: 0,
      loading: false,
      error: undefined,
      hasMore: true,
      loadMore: vi.fn(),
      retry: vi.fn(),
    }
    const item = sourceWithOwnExport()
    render(<SourceExports item={item} t={t} pager={pager} />)
    expect(screen.getByRole('button', { name: t('sourcePageMore') })).toBeTruthy()
  })
})
