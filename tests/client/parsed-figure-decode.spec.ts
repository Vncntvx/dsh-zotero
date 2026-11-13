// @vitest-environment jsdom
/** Browser decode must complete before a figure becomes part of a document. */
import { afterEach, expect, it, vi } from 'vitest'
import { decodeParsedFigure } from '../../src/client/parsed-documents.ts'

let image: { src: string; onload: (() => void) | null; onerror: (() => void) | null }
function browserImage() {
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      onload = null
      onerror = null
      constructor() {
        image = this
      }
    },
  )
}
afterEach(() => vi.unstubAllGlobals())

it('settles after image decode and removes the cancellation listener', async () => {
  browserImage()
  const pending = decodeParsedFigure('blob:figure', new AbortController().signal)
  expect(image.src).toBe('blob:figure')
  image.onload!()
  await pending
  expect(image.onerror).toBeNull()
})

it('reports a decode failure instead of publishing the broken figure', async () => {
  browserImage()
  const pending = decodeParsedFigure('blob:bad', new AbortController().signal)
  const verdict = expect(pending).rejects.toMatchObject({
    message: expect.stringContaining('decoded'),
  })
  image.onerror!()
  await verdict
  expect(image.src).toBe('')
})

it('cancels a pending browser load and never starts after prior cancellation', async () => {
  browserImage()
  const abort = new AbortController()
  const pending = decodeParsedFigure('blob:figure', abort.signal)
  const verdict = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  abort.abort()
  await verdict
  expect(image.src).toBe('')
  await expect(decodeParsedFigure('blob:figure', abort.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
})
