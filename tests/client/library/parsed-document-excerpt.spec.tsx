// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ParsedDocumentTab } from '../../../src/client/components/library/ParsedDocumentTab.tsx'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { observable } from '../enrichment/support/parse-ports.ts'
import { mockT } from '../helpers/mock-translate.ts'
import {
  composer,
  documentRead,
  METADATA,
  parsedRuntime,
  REF,
  SESSION,
} from './support/parsed-document.tsx'

const owned: Awaited<ReturnType<typeof parsedRuntime>>[] = []
afterEach(async () => {
  cleanup()
  for (const runtime of owned.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function selectPassage() {
  const passage = await screen.findByText('Selected passage')
  const range = document.createRange()
  range.selectNodeContents(passage)
  Object.defineProperty(range, 'getClientRects', { value: () => [new DOMRect(12, 10, 88, 20)] })
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  act(() => document.dispatchEvent(new Event('selectionchange')))
  return await screen.findByRole('menu')
}

async function mount(translate?: Parameters<typeof ParsedDocumentTab>[0]['translate']) {
  const input = composer()
  const runtime = await parsedRuntime(documentRead('Selected passage', { sourceRef: REF }))
  owned.push(runtime)
  const defaults = runtime.props({ actions: input })
  const readerConfig = observable({
    status: 'ready' as 'ready' | 'unavailable',
    value: {},
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: true,
  })
  const session = {
    removed: false,
    subagent: null,
    running: false,
    openState: 'open',
    blank: false,
  }
  const props = {
    ...defaults,
    readerConfig,
    translate,
    useRemoteAccess: () => true,
    useSession: (selector: (snapshot: typeof session) => unknown) => selector(session),
  } as typeof defaults
  render(<ParsedDocumentTab {...props} />)
  return { input, readerConfig, runtime }
}

it('sends only the selected parsed text on an explicit model request and quotes its artifact', async () => {
  const translate = vi.fn().mockResolvedValue('Ausgewählter Absatz')
  const { input } = await mount(translate)
  await selectPassage()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedTranslateExcerpt') }))
  fireEvent.change(screen.getByRole('combobox', { name: readerEn.translationTarget }), {
    target: { value: 'de' },
  })
  expect(translate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: readerEn.translationModel }))
  await screen.findByText('Ausgewählter Absatz')
  expect(translate).toHaveBeenCalledExactlyOnceWith(
    { sessionId: SESSION, text: 'Selected passage', target: 'de' },
    expect.any(AbortSignal),
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.translationQuote }))
  const draft = input.insertQuote.mock.calls[0]![0] as string
  expect(draft).toContain('Selected passage\n\nTranslation\nAusgewählter Absatz')
  expect(JSON.parse(draft.split('\n\n').at(-1)!)).toMatchObject({
    artifactId: METADATA.artifactId,
    attachmentRef: REF,
    fingerprint: METADATA.fingerprint,
    textRange: { start: 0, end: 'Selected passage'.length },
    textPrefix: 'Selected passage',
    sourceType: 'translation',
    translation: { target: 'de', engine: 'model' },
  })
  expect(input.persistDraft).toHaveBeenCalledOnce()
})

it('cancels translation when Reader stops serving the session model', async () => {
  const work = deferred<string>()
  const translate = vi.fn((_request: unknown, signal: AbortSignal) => {
    signal.addEventListener('abort', () => work.reject(signal.reason), { once: true })
    return work.promise
  })
  const { input, readerConfig } = await mount(translate)
  await selectPassage()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedTranslateExcerpt') }))
  fireEvent.click(screen.getByRole('button', { name: readerEn.translationModel }))
  const signal = translate.mock.calls[0]![1]
  expect(signal.aborted).toBe(false)
  await act(async () =>
    readerConfig.publish({ ...readerConfig.getSnapshot(), status: 'unavailable' }),
  )
  expect(signal.aborted).toBe(true)
  expect(screen.queryByRole('button', { name: readerEn.translationModel })).toBeNull()
  expect(input.insertQuote).not.toHaveBeenCalled()
})

it('creates a local PNG from the menu and quotes the parsed artifact without loading a PDF', async () => {
  const { input, runtime } = await mount()
  const png = new Blob(['png'], { type: 'image/png' })
  const fillText = vi.fn()
  const context = {
    fillRect: vi.fn(),
    fillText,
    measureText: (text: string) => ({ width: text.length }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(png))
  const revoke = vi.spyOn(URL, 'revokeObjectURL')
  await selectPassage()
  fireEvent.click(screen.getByRole('menuitem', { name: mockT('parsedCaptureExcerpt') }))
  const image = await screen.findByRole('img', { name: readerEn.documentCapturePreview })
  expect(fillText).toHaveBeenCalledWith(
    'Selected passage',
    expect.any(Number),
    expect.any(Number),
    expect.any(Number),
  )
  fireEvent.click(screen.getByRole('button', { name: readerEn.captureQuote }))
  const source = JSON.parse((input.insertQuote.mock.calls[0]![0] as string).split('\n\n').at(-1)!)
  expect(source).toMatchObject({ artifactId: METADATA.artifactId, sourceType: 'screenshot' })
  act(() => runtime.grant('zotero/documentArtifact').publish(false))
  expect(screen.queryByRole('img', { name: readerEn.documentCapturePreview })).toBeNull()
  expect(revoke).toHaveBeenCalledWith(image.getAttribute('src'))
})
