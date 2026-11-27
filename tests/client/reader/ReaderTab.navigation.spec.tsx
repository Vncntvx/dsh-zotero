// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab } from '../../../src/client/reader/ReaderTab.tsx'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { readerZh } from '../../../src/client/reader/locales.ts'
import type { mountPdf, PdfPasswordRequest } from '../../../src/client/reader/pdf-runtime.ts'
import { deferred } from '../../helpers/sync.ts'
import { pdfRuntime, propsOf, REF, SESSION, t } from './support/reader-tab.ts'

afterEach(() => cleanup())

it('sends the submitted password once, clears the field on retry, and cancels the pending load', async () => {
  const challenge =
    deferred<NonNullable<NonNullable<Parameters<typeof mountPdf>[5]>['onPassword']>>()
  const submit = vi.fn<PdfPasswordRequest['submit']>()
  const runtime = pdfRuntime()
  runtime.mountPdf.mockImplementation((_node, _bytes, signal, _onPage, _state, interactions) => {
    const onPassword = interactions?.onPassword
    if (!onPassword) throw new Error('Missing Reader password handler')
    challenge.resolve(onPassword)
    onPassword({ incorrect: false, submit })
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  render(<ReaderTab {...propsOf({ load: async () => runtime })} />)

  const input = await screen.findByLabelText(readerZh.passwordRequired)
  fireEvent.change(input, { target: { value: 'example-pdf-password' } })
  fireEvent.submit(input.closest('form')!)
  expect(submit).toHaveBeenCalledExactlyOnceWith('example-pdf-password')
  expect(screen.queryByLabelText(readerZh.passwordRequired)).toBeNull()

  const retry = await challenge.promise
  act(() => retry({ incorrect: true, submit }))
  expect((screen.getByLabelText(readerZh.passwordRequired) as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('alert').textContent).toBe(readerZh.passwordIncorrect)
  fireEvent.click(screen.getByRole('button', { name: readerZh.cancel }))
  await screen.findByText(t('failed', { message: readerZh.passwordCanceled }))
  expect(runtime.mountPdf.mock.lastCall?.[2].aborted).toBe(true)
})

it('retries after a failed file read and sends page, outline, find, and zoom controls to the recovered viewer', async () => {
  const runtime = pdfRuntime()
  const bytes = new Uint8Array()
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('File went offline'))
    .mockResolvedValue(bytes)
  runtime.controls.getOutline.mockResolvedValue([
    {
      id: 'methods',
      title: 'Methods',
      destination: null,
      children: [{ id: 'design', title: 'Design', destination: 'section-2', children: [] }],
    },
  ])
  render(<ReaderTab {...propsOf({ load: async () => runtime, read })} />)

  expect((await screen.findByRole('alert')).textContent).toContain('File went offline')
  fireEvent.click(screen.getByRole('button', { name: readerZh.retry }))
  const page = await screen.findByRole('textbox', { name: readerZh.page })
  const report = runtime.mountPdf.mock.lastCall?.[3]
  act(() => report?.({ page: 1, count: 3, fingerprint: 'fingerprint', sectionId: 'design' }))
  fireEvent.change(page, { target: { value: '2' } })
  fireEvent.submit(page.closest('form')!)
  expect(runtime.controls.goTo).toHaveBeenCalledWith(2)

  fireEvent.click(screen.getByRole('button', { name: readerZh.outline }))
  fireEvent.click(await screen.findByRole('button', { name: 'Design', current: 'location' }))
  expect(runtime.controls.goToOutline).toHaveBeenCalledExactlyOnceWith('section-2')

  const find = screen.getByRole('searchbox', { name: readerZh.find })
  fireEvent.change(find, { target: { value: ' outcomes ' } })
  fireEvent.click(screen.getByRole('button', { name: readerZh.findPrevious }))
  expect(runtime.controls.find).toHaveBeenLastCalledWith(' outcomes ', true)
  fireEvent.click(screen.getByRole('button', { name: readerZh.zoomIn }))
  expect(runtime.controls.zoom).toHaveBeenCalledWith(1.2)
})

it('fits and rotates the current PDF while an unavailable outline destination leaves navigation usable', async () => {
  const runtime = pdfRuntime(undefined, { count: 2 })
  runtime.controls.getOutline.mockResolvedValue([
    { id: 'methods', title: 'Methods', destination: 'methods', children: [] },
  ])
  runtime.controls.goToOutline.mockRejectedValueOnce(new Error('Missing PDF destination'))
  render(<ReaderTab {...propsOf({ load: async () => runtime })} />)
  const more = await screen.findByRole('button', { name: readerZh.toolbarMore })
  for (const action of [readerZh.fitPage, readerZh.rotateCounterclockwise]) {
    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: action }))
  }
  expect(runtime.controls.fit).toHaveBeenCalledExactlyOnceWith('page-fit')
  expect(runtime.controls.rotate).toHaveBeenCalledExactlyOnceWith(-1)

  fireEvent.click(screen.getByRole('button', { name: readerZh.outline }))
  fireEvent.click(await screen.findByRole('button', { name: 'Methods' }))
  await screen.findByText(readerZh.outlineFailed)
  fireEvent.click(screen.getByRole('button', { name: readerZh.next }))
  expect(runtime.controls.goTo).toHaveBeenLastCalledWith(2)
})

it('opens the resolved local file in native preview after a viewer failure', async () => {
  const openResource = vi.fn()
  const props = propsOf({ load: () => undefined })
  const info = props.useTabInfo()
  render(
    <ReaderTab
      {...props}
      useTabInfo={() => ({
        ...info,
        tab: { ...info.tab, actions: { ...info.tab.actions, openResource } },
      })}
    />,
  )
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: readerZh.native }))
  expect(props.read).not.toHaveBeenCalled()
  expect(openResource).toHaveBeenCalledExactlyOnceWith(
    fileAddressFor(SESSION, undefined, 'papers/paper.pdf'),
    { replaceTab: true },
  )
})

it('opens Zotero at the current physical page and clears the launch failure on retry', async () => {
  const openProtocol = vi
    .fn<Parameters<typeof ReaderTab>[0]['openProtocol']>()
    .mockRejectedValueOnce(new Error('Desktop unavailable'))
    .mockResolvedValueOnce(true)
  const runtime = pdfRuntime(undefined, { page: 2, count: 3, label: 'iv' })
  render(<ReaderTab {...propsOf({ load: async () => runtime, openProtocol })} />)

  const more = await screen.findByRole('button', { name: readerZh.toolbarMore })
  const launch = async () => {
    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: readerZh.zotero }))
  }
  await launch()
  await screen.findByText(readerZh.zoteroFailed)
  await launch()
  await waitFor(() => expect(screen.queryByText(readerZh.zoteroFailed)).toBeNull())
  expect(openProtocol.mock.calls).toEqual([
    ['zotero://open-pdf/library/items/ABCD1234?page=2'],
    ['zotero://open-pdf/library/items/ABCD1234?page=2'],
  ])
})

it('releases a pending byte read on access revocation and ignores its late bytes', async () => {
  const pending = deferred<Uint8Array<ArrayBuffer>>()
  const started = deferred<AbortSignal>()
  const runtime = pdfRuntime()
  const props = propsOf({
    load: async () => runtime,
    read: (_session, _path, signal) => {
      started.resolve(signal)
      return pending.promise
    },
  })
  const view = render(<ReaderTab {...props} />)
  const signal = await started.promise
  view.rerender(
    <ReaderTab {...props} useAccess={(action) => action !== 'workspaceFiles/readBytes'} />,
  )
  expect(signal.aborted).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(readerZh.unavailable)
  await act(async () => pending.resolve(new Uint8Array()))
  expect(runtime.mountPdf).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: readerZh.retry })).toBeNull()
})

it('uses the current physical page in the Zotero link and reports a failed native launch', async () => {
  const openProtocol = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const runtime = pdfRuntime(undefined, { page: 2, label: 'iv' })
  const props = propsOf({ openProtocol, load: async () => runtime })
  render(<ReaderTab {...props} />)
  const more = await screen.findByRole('button', { name: readerZh.toolbarMore })
  const clickOpen = async () => {
    fireEvent.click(more)
    fireEvent.click(await screen.findByRole('menuitem', { name: readerZh.zotero }))
  }
  await clickOpen()
  await screen.findByText(readerZh.zoteroFailed)
  expect(openProtocol).toHaveBeenCalledExactlyOnceWith(
    `zotero://open-pdf/library/items/${REF.split('/').at(-1)}?page=2`,
  )
  await clickOpen()
  await act(async () => {})
  expect(screen.queryByText(readerZh.zoteroFailed)).toBeNull()
})

it('waits for the viewer controls before acting on the initial page and evidence location', async () => {
  const runtime = pdfRuntime()
  const mounting = deferred<typeof runtime.controls>()
  const reported = deferred<void>()
  runtime.mountPdf.mockImplementation((_node, _bytes, _signal, onPage) => {
    onPage({ page: 1, count: 2, fingerprint: 'initial' })
    reported.resolve()
    return mounting.promise
  })
  const position = { pageIndex: 1, rects: [{ x: 10, y: 20, width: 30, height: 15 }] }
  const props = propsOf({ load: async () => runtime })
  const { tab } = props.useTabInfo()
  render(
    <ReaderTab
      {...props}
      useTabInfo={() => ({
        ...props.useTabInfo(),
        tab: { ...tab, navigation: { ...tab.navigation, params: { position } } },
      })}
    />,
  )

  await act(async () => reported.promise)
  expect(screen.queryByRole('textbox', { name: readerZh.page })).toBeNull()
  await act(async () => mounting.resolve(runtime.controls))
  expect(screen.getByRole('textbox', { name: readerZh.page })).toBeTruthy()
  expect(runtime.controls.setEvidence).toHaveBeenCalledExactlyOnceWith(position)
})

it.each([
  { expectedFingerprint: `sha256:${'a'.repeat(64)}`, pageIndex: 1, notice: undefined },
  {
    expectedFingerprint: `sha256:${'b'.repeat(64)}`,
    pageIndex: 1,
    notice: readerZh.quoteAttachmentChanged,
  },
  { expectedFingerprint: 'legacy-copy', pageIndex: 1, notice: readerZh.quoteFingerprintUnverified },
  {
    expectedFingerprint: `sha256:${'a'.repeat(64)}`,
    pageIndex: 3,
    notice: readerZh.quotePageUnavailable,
  },
])(
  'checks a historical citation against the loaded PDF before navigating ($expectedFingerprint, page $pageIndex)',
  async ({ expectedFingerprint, pageIndex, notice }) => {
    const runtime = pdfRuntime(undefined, { count: 2, fingerprint: `sha256:${'a'.repeat(64)}` })
    const props = propsOf({ load: async () => runtime })
    const { tab } = props.useTabInfo()
    const position = { pageIndex, rects: [{ x: 10, y: 20, width: 30, height: 15 }] }
    render(
      <ReaderTab
        {...props}
        useTabInfo={() => ({
          ...props.useTabInfo(),
          tab: {
            ...tab,
            navigation: { ...tab.navigation, params: { position, expectedFingerprint } },
          },
        })}
      />,
    )
    await screen.findByRole('textbox', { name: readerZh.page })
    expect(runtime.controls.setEvidence).toHaveBeenCalledExactlyOnceWith(
      notice ? undefined : position,
    )
    if (notice) expect(screen.getByText(notice)).toBeTruthy()
  },
)

it('reloads an already open PDF when the same tab is navigated from citation history', async () => {
  const fingerprint = `sha256:${'a'.repeat(64)}`
  const runtime = pdfRuntime(undefined, { count: 2, fingerprint })
  const read = vi.fn(async () => new Uint8Array())
  const props = propsOf({ load: async () => runtime, read })
  const { rerender } = render(<ReaderTab {...props} />)
  await screen.findByRole('textbox', { name: readerZh.page })
  const { tab } = props.useTabInfo()
  const position = { pageIndex: 1, rects: [] }
  rerender(
    <ReaderTab
      {...props}
      useTabInfo={() => ({
        ...props.useTabInfo(),
        tab: {
          ...tab,
          navigation: {
            ...tab.navigation,
            revision: 1,
            params: { position, expectedFingerprint: fingerprint },
          },
        },
      })}
    />,
  )
  await screen.findByRole('textbox', { name: readerZh.page })
  expect(read).toHaveBeenCalledTimes(2)
  expect(runtime.controls.setEvidence).toHaveBeenLastCalledWith(position)
})
