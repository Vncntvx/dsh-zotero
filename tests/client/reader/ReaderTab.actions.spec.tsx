// @vitest-environment jsdom
/**
 * ReaderTab overlap picking and denied-access rendering. Session identity
 * specs live in `ReaderTab.session.spec.tsx`.
 * @module tests/client/reader/ReaderTab.actions
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { readerZh } from '../../../src/client/reader/locales.ts'

import { pdfRuntime, propsOf, t } from './support/reader-tab.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReaderTab optional actions', () => {
  it('lets the user choose between overlapping marks without moving the PDF', async () => {
    const refs = ['zotero://user/0/annotation/ANNO0001', 'zotero://user/0/annotation/ANNO0002']
    const runtime = pdfRuntime()
    const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
      items: refs.map((ref, index) => ({
        ref,
        type: 'highlight',
        text: `Passage ${index + 1}`,
        pageLabel: index === 0 ? 'i' : 'ii',
        position: { pageIndex: 0, rects: [{ x: 10, y: 10, width: 50, height: 20 }] },
      })),
      total: 2,
      returned: 2,
      offset: 0,
      limit: 50,
      writeEnabled: false,
    })
    render(<ReaderTab {...propsOf({ load: async () => runtime, annotations })} />)
    await act(async () => {})

    act(() => runtime.mountPdf.mock.lastCall?.[5]?.onAnnotationPick?.(refs))
    expect(screen.getByRole('group', { name: readerZh.annotationOverlap })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Passage 2' }))

    expect(runtime.controls.setSelectedAnnotation).toHaveBeenLastCalledWith(refs[1])
    expect(runtime.controls.goTo).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', {
        name: t('annotationPage', { label: 'ii', page: 1 }),
        pressed: true,
      }),
    ).toBeTruthy()
  })

  it('renders a PDF reader without optional remote or write actions when access is denied', async () => {
    const runtime = pdfRuntime()
    const base = propsOf({ load: async () => runtime })
    const props = {
      ...base,
      useRemoteAccess: () => false,
      useAccess: () => false,
      useSession: (() => 'closed') as unknown as typeof base.useSession,
    } as typeof base
    render(<ReaderTab {...props} />)
    await act(async () => {})

    expect(screen.queryByRole('button', { name: readerZh.annotations })).toBeNull()
    expect(screen.queryByRole('button', { name: readerZh.translate })).toBeNull()
    expect(screen.queryByRole('button', { name: readerZh.details })).toBeNull()
    expect(screen.getByText(readerZh.unavailable)).toBeTruthy()
  })
})
