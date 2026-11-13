// @vitest-environment jsdom
/** One generation owns all its figure bytes and Blob URLs. */
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentRead, parsedRuntime, type ArtifactAnswer } from './support/parsed-document.tsx'
import { deferred } from '../../helpers/sync.ts'
import { mockT } from '../helpers/mock-translate.ts'

const owned: ReturnType<typeof parsedRuntime>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})
const image = (name: string, value: number) => ({
  name,
  mediaType: 'image/png' as const,
  bytes: 4,
  base64: btoa(String.fromCharCode(137, 80, 78, value)),
})
const tick = async () => {
  await act(async () => {})
}

describe('prepared parsed figures', () => {
  it('waits for the browser image load before publishing the document', async () => {
    const BrowserImage = globalThis.Image
    let figure: { src: string; onload: (() => void) | null }
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        onload = null
        onerror = null
        constructor() {
          figure = this
        }
      },
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:decoded')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    try {
      const runtime = parsedRuntime(
        documentRead('# Decoded\n\n![figure](images/figure.png)', {
          images: [image('images/figure.png', 1)],
        }),
        { decode: undefined },
      )
      owned.push(runtime)
      runtime.mount()
      await tick()
      expect(figure!.src).toBe('blob:decoded')
      expect(screen.queryByRole('img')).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Decoded' })).toBeNull()
      await act(async () => {
        figure!.onload!()
      })
      expect(screen.getByRole('heading', { name: 'Decoded' })).toBeDefined()
      expect(screen.getByRole('img').getAttribute('src')).toBe('blob:decoded')
    } finally {
      vi.stubGlobal('Image', BrowserImage)
    }
  })

  it('waits for every figure, then replaces same-name images on refresh', async () => {
    const red = image('images/figure.png', 1)
    const blue = image('images/figure.png', 2)
    const first = documentRead('# Generation1\n\n![figure](images/figure.png)', { images: [red] })
    const pending = deferred<ArtifactAnswer>()
    const answer = await first({
      sessionId: 'parsed-session',
      op: 'image',
      lease: '11111111-1111-4111-8111-111111111111',
      name: red.name,
    })
    first.mockImplementationOnce(
      async (request) =>
        await documentRead('# Generation1\n\n![figure](images/figure.png)', { images: [red] })(
          request,
        ),
    )
    first.mockImplementationOnce(async () => await pending.promise)
    const created = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:red')
      .mockReturnValueOnce('blob:blue')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const runtime = parsedRuntime(first)
    owned.push(runtime)
    runtime.mount()
    await tick()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Generation1' })).toBeNull()
    pending.resolve(answer)
    await tick()
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:red')
    first.mockImplementation(
      documentRead('# Generation2\n\n![figure](images/figure.png)', {
        images: [blue],
        artifactId: 'd'.repeat(64),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
    await tick()
    expect(screen.getByRole('heading', { name: 'Generation2' })).toBeDefined()
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:blue')
    expect(created).toHaveBeenCalledTimes(2)
    expect(revoked).toHaveBeenCalledWith('blob:red')
    await runtime.dispose()
    expect(revoked).toHaveBeenCalledWith('blob:blue')
  })

  it('does not silently omit figures beyond the old 64-image cap', async () => {
    const images = Array.from({ length: 70 }, (_, index) => image(`images/f${index}.png`, index))
    const text = images.map((image) => `![figure](${image.name})`).join('\n\n')
    const read = documentRead(text, { images })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${Math.random()}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const runtime = parsedRuntime(read)
    owned.push(runtime)
    runtime.mount()
    await tick()
    expect(read.mock.calls.filter(([request]) => request.op === 'image')).toHaveLength(70)
    expect(screen.getAllByRole('img')).toHaveLength(70)
  })

  it('releases failed candidates and retries figures on the next explicit refresh', async () => {
    const images = [image('images/one.png', 1), image('images/two.png', 2)]
    const base = documentRead('![one](images/one.png)\n\n![two](images/two.png)', { images })
    const read = vi.fn<import('../../../src/client/parsed-documents.ts').ParsedArtifactRead>(
      async (request, signal) => {
        if (request.op === 'image' && request.name === 'images/two.png')
          throw new Error('Figure unavailable')
        return await base(request, signal)
      },
    )
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const runtime = parsedRuntime(read)
    owned.push(runtime)
    runtime.mount()
    await tick()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Figure unavailable')
    expect(revoked).toHaveBeenCalledWith('blob:one')
    read.mockImplementation(base)
    fireEvent.click(screen.getByRole('button', { name: mockT('parsedReload') }))
    await tick()
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })
})
