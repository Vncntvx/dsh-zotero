// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTab, type ReaderTabFace } from '../../../src/client/reader/ReaderTab.tsx'
import type { PdfCapture } from '../../../src/client/reader/pdf-capture.ts'
import { deferred } from '../../helpers/sync.ts'
import { pdfRuntime, propsOf, REF, SESSION, t } from './support/reader-tab.ts'

const capture: PdfCapture = {
  png: new Blob(['Fixture PNG'], { type: 'image/png' }),
  width: 100,
  height: 80,
  regions: [
    {
      pageIndex: 0,
      pageLabel: 'i',
      rects: [{ x: 12, y: 10, width: 34, height: 22 }],
    },
  ],
  text: '',
  textIncomplete: true,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openCapture(image: PdfCapture, face: Partial<ReaderTabFace>) {
  const runtime = pdfRuntime(undefined, { count: 2 })
  runtime.controls.capture.mockResolvedValue(image)
  const props = propsOf({ load: async () => runtime, ...face })
  const view = render(<ReaderTab {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: t('capture') }))
  const dialog = screen.getByRole('dialog', { name: t('capture') })
  vi.spyOn(dialog.firstElementChild!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 100, 80),
  )
  fireEvent.submit(screen.getByRole('form', { name: t('captureRegionTitle') }))
  await screen.findByRole('img', { name: t('capturePreview') })
  return { props, runtime, view }
}

it('requests only whole cached coordinates and reports a capture with an unlocated page as incomplete', async () => {
  const readParsedText = vi
    .fn<NonNullable<ReaderTabFace['readParsedText']>>()
    .mockResolvedValue({ text: 'Cached results', incomplete: false })
  const { runtime } = await openCapture(
    {
      ...capture,
      regions: [...capture.regions, { ...capture.regions[0]!, pageIndex: 1, pageLabel: 'ii' }],
    },
    { readParsedText },
  )
  runtime.controls.artifactSelection
    .mockResolvedValueOnce({ pageIndex: 0, box: [12.25, 10.75, 45.75, 31.25] })
    .mockResolvedValueOnce({ pageIndex: 1 })
  expect(readParsedText).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: t('captureExtractParsed') }))

  await screen.findByText('Cached results')
  expect(screen.getByText(t('captureTextIncomplete'))).toBeTruthy()
  expect(readParsedText).toHaveBeenCalledExactlyOnceWith(
    SESSION,
    expect.objectContaining({ attachmentRef: REF }),
    [{ pageIndex: 0, box: [13, 11, 45, 31] }],
    expect.any(AbortSignal),
  )
})

it('cancels a capture jump when cache access is withdrawn and allows a new jump after access returns', async () => {
  const stale = deferred<boolean>()
  const current = deferred<boolean>()
  const openParsedPassage = vi
    .fn<NonNullable<ReaderTabFace['openParsedPassage']>>()
    .mockReturnValueOnce(stale.promise)
    .mockReturnValueOnce(current.promise)
  const { props, runtime, view } = await openCapture(capture, { openParsedPassage })
  const region = { pageIndex: 0, box: [10, 10, 30, 30] } as const
  runtime.controls.artifactSelection.mockResolvedValue(region)
  const jump = () => screen.getByRole<HTMLButtonElement>('button', { name: t('locateInParsed') })
  await act(async () => fireEvent.click(jump()))
  const firstSignal = openParsedPassage.mock.calls[0]![3]
  expect(firstSignal.aborted).toBe(false)

  view.rerender(
    <ReaderTab {...props} useRemoteAccess={(method) => method !== 'zotero/documentArtifact'} />,
  )
  expect(firstSignal.aborted).toBe(true)
  expect(screen.queryByRole('button', { name: t('locateInParsed') })).toBeNull()
  view.rerender(<ReaderTab {...props} />)
  await act(async () => fireEvent.click(jump()))
  expect(openParsedPassage).toHaveBeenCalledTimes(2)

  await act(async () => stale.resolve(true))
  expect(screen.getByRole('img', { name: t('capturePreview') })).toBeTruthy()
  expect(jump().disabled).toBe(true)
  await act(async () => current.resolve(true))
  expect(screen.queryByRole('dialog', { name: t('capture') })).toBeNull()
})
