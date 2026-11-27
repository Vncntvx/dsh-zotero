// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ZOTERO_WRITE_APPROVAL_UNAVAILABLE } from '../../../src/error-codes.ts'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import { deferred } from '../../helpers/sync.ts'
import { pdfRuntime, propsOf, REF, SESSION, t } from './support/reader-tab.ts'

afterEach(cleanup)

it.each([
  { action: 'annotationEdit', state: 'visible' },
  { action: 'annotationDelete', state: 'visible' },
  { action: 'annotationDelete', state: 'hidden' },
  { action: 'annotationDelete', state: 'closed' },
] as const)(
  'restores focus after canceling $action only if the owning Reader is visible ($state)',
  async ({ action, state }) => {
    const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
      total: 1,
      returned: 1,
      offset: 0,
      limit: 50,
      writeEnabled: true,
      items: [
        {
          ref: 'zotero://user/0/annotation/ANNO0001',
          version: 10,
          type: 'highlight',
          text: 'Shared annotation',
        },
      ],
    })
    const props = propsOf({ annotations })
    const info = props.useTabInfo()
    const owner = render(<ReaderTab {...props} />)
    const other = render(
      <ReaderTab {...props} useTabInfo={() => ({ ...info, tab: { ...info.tab, id: 'tab-2' } })} />,
    )
    const first = within(owner.container)
    const second = within(other.container)
    for (const reader of [first, second]) {
      fireEvent.click(await reader.findByRole('button', { name: t('annotations') }))
      await reader.findByRole('button', { name: t(action) })
    }
    fireEvent.click(first.getByRole('button', { name: t(action) }))
    fireEvent.click(first.getByRole('button', { name: t('cancel') }))

    if (state === 'hidden') {
      owner.rerender(
        <ReaderTab
          {...props}
          useTabInfo={() => ({ ...info, tab: { ...info.tab, visible: false } })}
        />,
      )
    } else if (state === 'closed') {
      owner.unmount()
    }
    const outside = second.getByRole('button', { name: t('annotations') })
    if (state !== 'visible') outside.focus()
    // Run the focus callback already queued by the cancel action.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(document.activeElement).toBe(
      state === 'visible' ? first.getByRole('button', { name: t(action) }) : outside,
    )
  },
)

it('retries the failed annotation page in place and reconciles overlapping rows', async () => {
  const first = { ref: 'zotero://user/0/annotation/ANNO0001', type: 'highlight', text: 'First' }
  const second = { ref: 'zotero://user/0/annotation/ANNO0002', type: 'underline', text: 'Second' }
  const updated = { ...first, text: 'First updated' }
  const page = { total: 2, returned: 1, offset: 0, limit: 50, writeEnabled: false }
  const annotations = vi
    .fn<ReaderTabFace['annotations']>()
    .mockResolvedValueOnce({ ...page, items: [first], nextOffset: 1 })
    .mockRejectedValueOnce(new Error('Interrupted'))
    .mockResolvedValueOnce({ ...page, items: [updated, second], returned: 2, offset: 1 })
  const runtime = pdfRuntime()
  render(<ReaderTab {...propsOf({ annotations, load: async () => runtime })} />)
  fireEvent.click(await screen.findByRole('button', { name: t('annotations') }))
  const panel = within(screen.getByRole('complementary', { name: t('annotations') }))
  expect(await panel.findByText('First')).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: t('more') }))

  expect((await panel.findByRole('alert')).textContent).toBe(t('annotationFailed'))
  expect(panel.getByText('First')).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: t('retry') }))

  expect(await panel.findByText('Second')).toBeTruthy()
  expect(panel.queryByText('First', { exact: true })).toBeNull()
  expect(panel.getAllByText('First updated')).toHaveLength(1)
  expect(panel.queryByRole('alert')).toBeNull()
  expect(annotations.mock.calls.map(([request]) => request)).toEqual([
    expect.objectContaining({ sessionId: SESSION, ref: REF, offset: 0 }),
    expect.objectContaining({ sessionId: SESSION, ref: REF, offset: 1 }),
    expect.objectContaining({ sessionId: SESSION, ref: REF, offset: 1 }),
  ])
  expect(runtime.controls.setAnnotations).toHaveBeenLastCalledWith([updated, second])

  const types = within(panel.getByRole('group', { name: t('filter') }))
  fireEvent.click(types.getByRole('button', { name: 'underline' }))
  expect(types.getByRole('button', { name: 'underline', pressed: true })).toBeTruthy()
  expect(panel.queryByText('First updated')).toBeNull()
  expect(runtime.controls.setAnnotations).toHaveBeenLastCalledWith([second])

  fireEvent.click(types.getByRole('button', { name: t('allTypes') }))
  expect(panel.getByText('First updated')).toBeTruthy()
  expect(runtime.controls.setAnnotations).toHaveBeenLastCalledWith([updated, second])
})

it('drops an in-flight annotation page on permission loss and reads a fresh page when access returns', async () => {
  const firstRead = deferred<AbortSignal>()
  const stale = deferred<Awaited<ReturnType<ReaderTabFace['annotations']>>>()
  const row = {
    ref: 'zotero://user/0/annotation/ANNO0001',
    type: 'highlight',
    text: 'Current annotation',
  }
  const page = { total: 1, returned: 1, offset: 0, limit: 50, writeEnabled: false }
  const annotations = vi
    .fn<ReaderTabFace['annotations']>()
    .mockImplementationOnce((_request, signal) => {
      firstRead.resolve(signal)
      return stale.promise
    })
    .mockResolvedValueOnce({ ...page, items: [row] })
  const runtime = pdfRuntime()
  const props = propsOf({ annotations, load: async () => runtime })
  const view = render(<ReaderTab {...props} />)
  const signal = await firstRead.promise
  fireEvent.click(screen.getByRole('button', { name: t('annotations') }))

  view.rerender(
    <ReaderTab {...props} useRemoteAccess={(method) => method !== 'zotero/readerAnnotations'} />,
  )
  expect(signal.aborted).toBe(true)
  expect(screen.queryByRole('complementary', { name: t('annotations') })).toBeNull()
  expect(runtime.controls.setAnnotations).toHaveBeenLastCalledWith([])

  view.rerender(<ReaderTab {...props} />)
  expect(await screen.findByText(row.text)).toBeTruthy()
  await act(async () => stale.resolve({ ...page, items: [{ ...row, text: 'Revoked annotation' }] }))
  expect(screen.queryByText('Revoked annotation')).toBeNull()
  expect(runtime.controls.setAnnotations).toHaveBeenLastCalledWith([row])
  expect(annotations).toHaveBeenCalledTimes(2)
})

it('aborts a pending annotation edit on close and ignores its late receipt', async () => {
  const ref = 'zotero://user/0/annotation/ANNO0001'
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
    total: 1,
    returned: 1,
    offset: 0,
    limit: 50,
    writeEnabled: true,
    items: [{ ref, version: 10, type: 'highlight', text: 'Excerpt' }],
  })
  const receipt = deferred<Awaited<ReturnType<ReaderTabFace['updateAnnotation']>>>()
  const updateAnnotation = vi
    .fn<ReaderTabFace['updateAnnotation']>()
    .mockReturnValue(receipt.promise)
  const props = propsOf({ annotations, updateAnnotation })
  const view = render(<ReaderTab {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: t('annotations') }))
  fireEvent.click(await screen.findByRole('button', { name: t('annotationEdit') }))
  fireEvent.change(screen.getByRole('textbox', { name: t('annotationComment') }), {
    target: { value: 'Pending edit' },
  })
  fireEvent.click(screen.getByRole('button', { name: t('annotationSave') }))
  const signal = updateAnnotation.mock.calls[0]![1]
  expect(signal.aborted).toBe(false)

  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => receipt.resolve({ kind: 'applied', message: 'Late receipt' }))
  expect(annotations).toHaveBeenCalledOnce()
  expect(updateAnnotation).toHaveBeenCalledOnce()
})

it('keeps a versioned annotation edit available when approval requires an active conversation turn', async () => {
  const ref = 'zotero://user/0/annotation/ANNO0001'
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
    total: 1,
    returned: 1,
    offset: 0,
    limit: 50,
    writeEnabled: true,
    items: [{ ref, version: 10, type: 'highlight', text: 'Excerpt', comment: 'Original comment' }],
  })
  const refusal = new RemoteError(
    'zotero/write',
    'Approval requires an active conversation turn.',
    { code: ZOTERO_WRITE_APPROVAL_UNAVAILABLE },
  )
  const updateAnnotation = vi.fn<ReaderTabFace['updateAnnotation']>().mockRejectedValueOnce(refusal)
  render(<ReaderTab {...propsOf({ annotations, updateAnnotation })} />)
  fireEvent.click(await screen.findByRole('button', { name: t('annotations') }))
  fireEvent.click(await screen.findByRole('button', { name: t('annotationEdit') }))
  const comment = screen.getByRole<HTMLTextAreaElement>('textbox', { name: t('annotationComment') })
  fireEvent.change(comment, { target: { value: 'Keep this editable comment' } })
  const save = screen.getByRole<HTMLButtonElement>('button', { name: t('annotationSave') })
  fireEvent.click(save)
  await screen.findByText(t('annotationSaveFailed', { message: refusal.message }))
  expect(comment.value).toBe('Keep this editable comment')
  expect(save.matches(':disabled')).toBe(false)
  expect(annotations).toHaveBeenCalledOnce()
  expect(updateAnnotation).toHaveBeenCalledExactlyOnceWith(
    {
      sessionId: SESSION,
      ref,
      expectedVersion: 10,
      set: { annotationComment: 'Keep this editable comment' },
    },
    expect.any(AbortSignal),
  )
})

it('reconciles an unverified deletion by refreshing the annotation list without submitting twice', async () => {
  const ref = 'zotero://user/0/annotation/ANNO0001'
  const row = { ref, version: 10, type: 'underline', text: 'Pending removal' }
  const page = { offset: 0, limit: 50, writeEnabled: true }
  const annotations = vi
    .fn<ReaderTabFace['annotations']>()
    .mockResolvedValueOnce({ ...page, total: 1, returned: 1, items: [row] })
    .mockResolvedValueOnce({ ...page, total: 0, returned: 0, items: [] })
  const message = 'Zotero accepted deletion, but the immediate readback failed.'
  const deleteAnnotation = vi.fn<ReaderTabFace['deleteAnnotation']>().mockResolvedValue({
    kind: 'committed-unverified',
    message,
  })
  render(<ReaderTab {...propsOf({ annotations, deleteAnnotation })} />)
  fireEvent.click(await screen.findByRole('button', { name: t('annotations') }))
  fireEvent.click(await screen.findByRole('button', { name: t('annotationDelete') }))
  fireEvent.click(screen.getByRole('button', { name: t('annotationDeleteConfirm') }))

  expect((await screen.findByText(message)).getAttribute('role')).toBe('status')
  expect(screen.queryByText(row.text)).toBeNull()
  expect(screen.queryByRole('button', { name: t('annotationDeleteConfirm') })).toBeNull()
  expect(deleteAnnotation).toHaveBeenCalledExactlyOnceWith(
    { sessionId: SESSION, ref, expectedVersion: row.version },
    expect.any(AbortSignal),
  )
  expect(annotations).toHaveBeenCalledTimes(2)
})

it('asks which overlapping native mark to select and keeps selection in sync with the PDF overlay', async () => {
  const first = {
    ref: 'zotero://user/0/annotation/ANNO0001',
    type: 'highlight',
    text: 'First mark',
    color: '#ffd400',
    pageLabel: 'iv',
    position: { pageIndex: 1, rects: [{ x: 10, y: 20, width: 30, height: 8 }] },
  }
  const second = {
    ...first,
    ref: 'zotero://user/0/annotation/ANNO0002',
    type: 'underline',
    text: '',
  }
  const annotations = vi.fn<ReaderTabFace['annotations']>().mockResolvedValue({
    total: 2,
    returned: 2,
    offset: 0,
    limit: 50,
    writeEnabled: false,
    items: [first, second],
  })
  const runtime = pdfRuntime(undefined, { count: 2 })
  render(<ReaderTab {...propsOf({ annotations, load: async () => runtime })} />)
  await screen.findByRole('textbox', { name: t('page') })
  const pick = runtime.mountPdf.mock.lastCall?.[5]?.onAnnotationPick
  act(() => pick?.([first.ref, second.ref]))
  const choices = within(screen.getByRole('group', { name: t('annotationOverlap') }))
  expect(choices.getByRole('button', { name: first.text })).toBeTruthy()
  fireEvent.click(choices.getByRole('button', { name: t('underline') }))
  expect(runtime.controls.setSelectedAnnotation).toHaveBeenLastCalledWith(second.ref)

  const panel = within(screen.getByRole('complementary', { name: t('annotations') }))
  const pageName = t('annotationPage', { label: 'iv', page: 2 })
  expect(panel.getByRole('button', { name: pageName, pressed: true })).toBeTruthy()
  fireEvent.click(panel.getByRole('button', { name: pageName, pressed: false }))
  expect(runtime.controls.goTo).toHaveBeenCalledExactlyOnceWith(2)
  expect(runtime.controls.setSelectedAnnotation).toHaveBeenLastCalledWith(first.ref)
})
