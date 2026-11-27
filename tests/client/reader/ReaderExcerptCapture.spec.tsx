// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderExcerptCapture } from '../../../src/client/reader/ReaderExcerptCapture.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const png = new Blob(['fixture excerpt image'], { type: 'image/png' })
const t = makeTranslate(readerEn)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function open(region?: Parameters<typeof ReaderExcerptCapture>[0]['region']) {
  const owner = new AbortController()
  const canvas = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 10 }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    canvas as unknown as CanvasRenderingContext2D,
  )
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) => callback(png))
  const create = vi.spyOn(URL, 'createObjectURL')
  const view = render(
    <ReaderExcerptCapture
      t={t}
      title="Notes"
      text="Source excerpt"
      region={region}
      tabSignal={owner.signal}
      onClose={() => view.unmount()}
    />,
  )
  return { owner, canvas, encode, create }
}

it('falls back to text when the selected layout cannot be decoded', async () => {
  vi.stubGlobal(
    'Image',
    class extends Image {
      decode() {
        return Promise.reject(new Error('The browser cannot decode the layout'))
      }
    },
  )
  const { canvas, create } = open({
    src: 'data:image/svg+xml,cached-selection',
    width: 240,
    height: 40,
    background: '#fff',
  })
  await screen.findByRole('img', { name: readerEn.documentCapturePreview })
  expect(screen.getByText(readerEn.documentCaptureTextFallback)).toBeTruthy()
  expect(canvas.drawImage).not.toHaveBeenCalled()
  expect(canvas.fillText).toHaveBeenCalledWith('Source excerpt', 28, 86, 904)
  expect(create).toHaveBeenCalledExactlyOnceWith(png)
})

it('releases the canvas and discards an encoding result when the source tab closes', async () => {
  const pending = deferred<BlobCallback>()
  const { owner, encode, create } = open()
  encode.mockImplementation((callback) => pending.resolve(callback))
  const finish = await pending.promise
  expect(screen.getByText(readerEn.capturePending)).toBeTruthy()
  owner.abort()
  await act(async () => finish(png))
  const canvas = encode.mock.contexts[0] as HTMLCanvasElement
  expect([canvas.width, canvas.height]).toEqual([0, 0])
  expect(create).not.toHaveBeenCalled()
  expect(screen.queryByRole('img')).toBeNull()
})

it('leaves a downloadable PNG available when the browser refuses clipboard access', async () => {
  const write = vi.fn().mockRejectedValue(new DOMException('Unavailable', 'NotAllowedError'))
  vi.stubGlobal('ClipboardItem', class {})
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { write } } }))
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const { create } = open()
  const copy = await screen.findByRole('button', { name: readerEn.captureCopyImage })
  expect(write).not.toHaveBeenCalled()
  fireEvent.click(copy)
  await screen.findByText(readerEn.copyFailed)
  fireEvent.click(screen.getByRole('button', { name: readerEn.captureSave }))
  expect(click).toHaveBeenCalledOnce()
  const link = click.mock.contexts[0] as HTMLAnchorElement
  expect(link.download).toBe('zotero-excerpt.png')
  expect(link.isConnected).toBe(false)
  expect(create).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenLastCalledWith(png)
  fireEvent.click(screen.getByRole('button', { name: readerEn.cancel }))
  expect(revoke).toHaveBeenCalledWith(create.mock.results[0]?.value)
})

it('reports an encoding refusal without making an empty image available to quote or copy', async () => {
  const { encode, create } = open()
  encode.mockImplementation((callback) => callback(null))
  await screen.findByText(readerEn.captureFailed)
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByRole('button', { name: readerEn.captureSave })).toBeNull()
  expect(create).not.toHaveBeenCalled()
})
