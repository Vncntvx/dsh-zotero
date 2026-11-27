// @vitest-environment jsdom
/**
 * The Reader's session identity comes from the slot prop. A TabRecord carries
 * no `sessionId`; resolution and byte reads use the slot's session.
 * @module tests/client/reader/ReaderTab.session
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { readerAddress } from '../../../src/client/reader/address.ts'
import { readerZh } from '../../../src/client/reader/locales.ts'
import type { mountPdf as mountPdfRuntime } from '../../../src/client/reader/pdf-runtime.ts'

import { pdfRuntime, propsOf, REF, SESSION, t } from './support/reader-tab.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReaderTab session identity', () => {
  it('opens the document when the address session matches the slot session prop', () => {
    // A real TabRecord has no sessionId. Rendering must not gate on that missing
    // field, otherwise every reader tab shows the permanent unavailable notice.
    render(<ReaderTab {...propsOf()} />)
    expect(screen.queryByText(readerZh.unavailable)).toBeNull()
  })

  it('refuses an address that belongs to a different session', () => {
    render(<ReaderTab {...propsOf({}, readerAddress('another-session', REF))} />)
    expect(screen.getByText(readerZh.unavailable)).toBeTruthy()
  })

  it('reads the attachment bytes with the slot session id', async () => {
    const read = vi.fn<ReaderTabFace['read']>(async () => new Uint8Array())
    render(<ReaderTab {...propsOf({ read })} />)
    await act(async () => {})
    expect(read).toHaveBeenCalled()
    expect(read.mock.calls[0]?.[0]).toBe(SESSION)
  })

  it('keeps the printed folio on the context line and the page count compact', async () => {
    // The top bar is steered by the physical page alone; a journal folio is
    // citation context and sits with the section instead of widening the bar.
    const runtime = pdfRuntime(undefined, {
      page: 4,
      count: 21,
      label: '190',
      sectionTitle: 'Introduction',
    })
    render(<ReaderTab {...propsOf({ load: async () => runtime })} />)
    await act(async () => {})

    expect(
      screen.getByRole('form', { name: t('pagePosition', { page: 4, count: 21 }) }),
    ).toBeTruthy()
    expect(screen.getByText(t('pageCount', { count: 21 }))).toBeTruthy()
    expect(screen.getByText(t('currentSection', { title: 'Introduction' }))).toBeTruthy()
    expect(
      screen.getByText(t('pageLabel', { label: '190' })).closest('[role="toolbar"]'),
    ).toBeNull()
  })

  it('filters annotation rows by their normalized Zotero color', async () => {
    const annotations = vi.fn<ReaderTabFace['annotations']>(async () => ({
      total: 2,
      returned: 2,
      offset: 0,
      limit: 50,
      writeEnabled: false,
      items: [
        { ref: 'yellow', type: 'highlight', color: '#FFD400', text: 'yellow passage' },
        { ref: 'red', type: 'highlight', color: '#ff0000', text: 'red passage' },
      ],
    })) as unknown as ReaderTabFace['annotations']
    render(<ReaderTab {...propsOf({ annotations })} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotations }))

    fireEvent.click(
      screen.getByRole('button', {
        name: readerZh.filterColorValue.replace('{color}', '#ff0000'),
      }),
    )

    expect(screen.getByText('red passage')).toBeTruthy()
    expect(screen.queryByText('yellow passage')).toBeNull()
  })

  it('submits a Reader edit once with the displayed version and refreshes after a conflict', async () => {
    const ref = 'zotero://user/0/annotation/ANNO0001'
    const annotations = vi
      .fn<ReaderTabFace['annotations']>()
      .mockResolvedValueOnce({
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        writeEnabled: true,
        items: [
          {
            ref,
            version: 10,
            type: 'highlight',
            text: 'quoted passage',
            comment: 'old comment',
            tags: ['Previous'],
          },
        ],
      })
      .mockResolvedValue({
        total: 1,
        returned: 1,
        offset: 0,
        limit: 50,
        writeEnabled: true,
        items: [
          {
            ref,
            version: 11,
            type: 'highlight',
            text: 'quoted passage',
            comment: 'current comment',
          },
        ],
      })
    const updateAnnotation = vi.fn<ReaderTabFace['updateAnnotation']>().mockResolvedValue({
      kind: 'failed',
      code: 'ZOTERO_WRITE_CONFLICT',
      message: 'Conflict',
    })
    render(<ReaderTab {...propsOf({ annotations, updateAnnotation })} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotations }))
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotationEdit }))
    fireEvent.change(screen.getByLabelText(readerZh.annotationComment), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(readerZh.annotationAddTag), {
      target: { value: 'Review' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Previous' }))
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotationSave }))
    await act(async () => {})

    expect(updateAnnotation).toHaveBeenCalledExactlyOnceWith(
      {
        sessionId: SESSION,
        ref,
        expectedVersion: 10,
        set: { annotationComment: '' },
        tagChanges: { add: ['Review'], remove: ['Previous'] },
      },
      expect.any(AbortSignal),
    )
    expect(annotations).toHaveBeenCalledTimes(2)
    expect(screen.getByText(readerZh.annotationConflict)).toBeTruthy()
    expect(screen.getByText('current comment')).toBeTruthy()
  })

  it('submits a cross-page selection once and shows each page receipt', async () => {
    const pages = [0, 1, 2].map((pageIndex) => ({
      pageIndex,
      text: `Passage ${pageIndex + 1}`,
      pageLabel: String(pageIndex + 1),
      textOffset: 0,
      top: 25,
      rects: [{ x: 10, y: 20, width: 30, height: 12 }],
    }))
    const runtime = pdfRuntime(
      { text: pages.map(({ text }) => text).join('\n'), pages, canAnnotate: true },
      { count: pages.length },
    )
    const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
      items: [],
      total: 0,
      returned: 0,
      limit: 50,
      offset: 0,
      writeEnabled: true,
    })
    const createAnnotations = vi.fn<ReaderTabFace['createAnnotations']>().mockResolvedValue({
      kind: 'settled',
      pages: [
        { pageIndex: 0, status: 'applied', ref: 'zotero://user/0/annotation/ANNO0001' },
        { pageIndex: 1, status: 'failed', message: 'Page refused' },
        { pageIndex: 2, status: 'committed-unverified' },
      ],
    })
    render(
      <ReaderTab {...propsOf({ load: async () => runtime, annotations, createAnnotations })} />,
    )

    fireEvent.click(await screen.findByRole('button', { name: readerZh.addUnderline }))
    fireEvent.change(screen.getByLabelText(readerZh.annotationComment), {
      target: { value: 'Compare with the results' },
    })
    const form = screen.getByRole('form', { name: readerZh.addUnderline })
    fireEvent.submit(form)
    fireEvent.submit(form)
    await act(async () => {})

    expect(createAnnotations).toHaveBeenCalledExactlyOnceWith(
      {
        sessionId: SESSION,
        ref: REF,
        type: 'underline',
        pages,
        color: '#ffd400',
        comment: 'Compare with the results',
      },
      expect.any(AbortSignal),
    )
    expect(screen.getByText(t('annotationCreated', { page: 1 }))).toBeTruthy()
    expect(
      screen.getByText(t('annotationCreateFailed', { page: 2, message: 'Page refused' })),
    ).toBeTruthy()
    expect(screen.getByText(t('annotationCreateUnverified', { page: 3, ref: REF }))).toBeTruthy()
    expect(annotations).toHaveBeenCalledTimes(2)
  })

  it('floats selection actions over the page instead of pushing the page down', async () => {
    const runtime = pdfRuntime({
      text: 'Passage',
      pages: [
        {
          pageIndex: 0,
          text: 'Passage',
          pageLabel: '1',
          textOffset: 0,
          top: 25,
          rects: [{ x: 10, y: 20, width: 30, height: 12 }],
        },
      ],
      canAnnotate: false,
      nearBottom: true,
    })
    render(<ReaderTab {...propsOf({ load: async () => runtime })} />)

    const actions = await screen.findByRole('group', { name: readerZh.selection })
    // The actions sit on the page surface rather than in a row above it, so
    // selecting text cannot reflow the document, and a selection low on the page
    // takes the opposite edge instead of sitting under the bar.
    expect(actions.parentElement?.contains(runtime.page() ?? null)).toBe(true)
    expect(actions.getAttribute('data-side')).toBe('top')
    expect(screen.queryByRole('button', { name: readerZh.zoomOut })).toBeNull()
  })

  it('asks for deletion confirmation and removes the annotation after the result', async () => {
    const ref = 'zotero://user/0/annotation/ANNO0001'
    const page = { items: [], total: 0, returned: 0, offset: 0, limit: 50, writeEnabled: true }
    const annotations = vi
      .fn<ReaderTabFace['annotations']>()
      .mockResolvedValueOnce({
        ...page,
        total: 1,
        returned: 1,
        items: [{ ref, version: 10, type: 'underline', text: 'Extra mark' }],
      })
      .mockResolvedValue(page)
    const deleteAnnotation = vi.fn<ReaderTabFace['deleteAnnotation']>().mockResolvedValue({
      kind: 'applied',
      message: 'Deleted',
    })
    render(<ReaderTab {...propsOf({ annotations, deleteAnnotation })} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotations }))
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotationDelete }))

    expect(screen.getByText(readerZh.annotationDeletePrompt)).toBeTruthy()
    expect(deleteAnnotation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotationDeleteConfirm }))
    await act(async () => {})

    expect(deleteAnnotation).toHaveBeenCalledExactlyOnceWith(
      { sessionId: SESSION, ref, expectedVersion: 10 },
      expect.any(AbortSignal),
    )
    expect(screen.queryByText('Extra mark')).toBeNull()
    expect(screen.getByText('Deleted')).toBeTruthy()
  })

  it('cancels an annotation edit on Escape and keeps the row on a native dropdown', async () => {
    const ref = 'zotero://user/0/annotation/ANNO0001'
    const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
      items: [{ ref, version: 10, type: 'highlight', text: 'quoted passage' }],
      total: 1,
      returned: 1,
      offset: 0,
      limit: 50,
      writeEnabled: true,
    })
    render(<ReaderTab {...propsOf({ annotations })} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotations }))
    fireEvent.click(screen.getByRole('button', { name: readerZh.annotationEdit }))
    const form = screen.getByRole('form', { name: readerZh.annotationEdit })

    // An open native dropdown consumes Escape; the form stays mounted.
    fireEvent.keyDown(screen.getByLabelText(readerZh.annotationType), { key: 'Escape' })
    expect(screen.getByRole('form', { name: readerZh.annotationEdit })).toBeTruthy()

    fireEvent.keyDown(form, { key: 'Escape' })
    expect(screen.queryByRole('form', { name: readerZh.annotationEdit })).toBeNull()
  })

  it('marks the loading state as busy for assistive technology', () => {
    const runtime = {
      mountPdf: vi.fn<typeof mountPdfRuntime>(() => new Promise<never>(() => undefined)),
    }
    render(<ReaderTab {...propsOf({ load: async () => runtime })} />)

    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
  })

  it.each([
    { count: 1, precision: 'region' },
    { count: 49, precision: 'page' },
  ])(
    'adds bounded $precision provenance to the draft without sending',
    async ({ count, precision }) => {
      const text = 'Selected passage only'
      const rects = Array.from({ length: count }, () => ({ x: 1, y: 2, width: 3, height: 4 }))
      const runtime = pdfRuntime(
        {
          text,
          pages: [{ pageIndex: 2, pageLabel: 'iii', rects, text, top: 4, textOffset: 2 }],
          canAnnotate: true,
        },
        { count: 3 },
      )
      const inputActions = {
        insertQuote: vi.fn<(text: string, quote: { body: string }) => boolean>(() => true),
        persistDraft: vi.fn(),
        submit: vi.fn(),
      }
      const props = propsOf({ load: async () => runtime })
      render(<ReaderTab {...({ ...props, inputActions } as typeof props)} />)
      await screen.findByRole('textbox', { name: readerZh.page })
      fireEvent.click(await screen.findByRole('button', { name: readerZh.quote }))
      const [draft, quote] = inputActions.insertQuote.mock.calls[0]!
      expect(draft).toContain(`${REF} · 物理页 3`)
      expect(quote.body).toBe(text)
      const provenance = JSON.parse(draft.split('\n\n').at(-1)!)
      expect(provenance).toMatchObject({
        attachmentRef: REF,
        fingerprint: 'fingerprint',
        sourceType: 'selection',
        precision,
        pages: [{ pageIndex: 2, pageLabel: 'iii' }],
      })
      expect(provenance.pages[0].rects).toEqual(precision === 'region' ? rects : undefined)
      expect(inputActions.persistDraft).toHaveBeenCalledOnce()
      expect(inputActions.submit).not.toHaveBeenCalled()
    },
  )
})
