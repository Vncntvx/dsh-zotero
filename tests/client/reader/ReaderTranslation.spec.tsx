// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReaderTranslation } from '../../../src/client/reader/ReaderTranslation.tsx'
import { ReaderTranslationTargetContext } from '../../../src/client/reader/translation-preferences.ts'
import { readerEn } from '../../../src/client/reader/locales.ts'
import { deferred } from '../../helpers/sync.ts'
import { makeTranslate } from '../helpers/mock-translate.ts'

const t = makeTranslate(readerEn)
const text = 'Une expérience'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('requires confirmation and reuses the language-pair result for the same excerpt', async () => {
  const translated = 'An experiment'
  const create = vi
    .fn()
    .mockResolvedValue({ translate: vi.fn().mockResolvedValue(translated), destroy: vi.fn() })
  vi.stubGlobal('Translator', { create })
  const quote = vi.fn(() => true)
  const cache = new Map<string, string>()
  const props = {
    t,
    text,
    tabSignal: new AbortController().signal,
    cache,
    onQuote: quote,
    onClose: vi.fn(),
  }
  function request() {
    fireEvent.change(screen.getByLabelText(readerEn.translationSource), { target: { value: 'fr' } })
    fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'en' } })
    fireEvent.click(screen.getByRole('button', { name: readerEn.translate }))
  }
  const first = render(<ReaderTranslation {...props} />)
  expect(create).not.toHaveBeenCalled()
  request()
  expect(await screen.findByText(translated)).toBeTruthy()
  expect(screen.getByText(text)).toBeTruthy()
  first.unmount()
  render(<ReaderTranslation {...props} />)
  request()
  expect(screen.getByText(translated)).toBeTruthy()
  expect(create).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: readerEn.translationQuote }))
  expect(quote).toHaveBeenCalledExactlyOnceWith({
    text: translated,
    target: 'en',
    engine: 'browser',
  })
})

it('starts with the configured default target language', () => {
  const create = vi.fn().mockResolvedValue({
    translate: vi.fn().mockResolvedValue('Ein Experiment'),
    destroy: vi.fn(),
  })
  vi.stubGlobal('Translator', { create })
  render(
    <ReaderTranslationTargetContext.Provider value="de">
      <ReaderTranslation
        t={t}
        text={text}
        tabSignal={new AbortController().signal}
        cache={new Map()}
        onClose={vi.fn()}
      />
    </ReaderTranslationTargetContext.Provider>,
  )
  expect(screen.getByLabelText(readerEn.translationTarget)).toHaveProperty('value', 'de')
})

it('shows browser language-model download progress', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const translation = deferred<string>()
  const create = vi
    .fn()
    .mockImplementation(
      ({
        monitor,
      }: {
        monitor?: (monitor: {
          addEventListener: (_type: string, listener: (event: { loaded: number }) => void) => void
        }) => void
      }) => {
        monitor?.({ addEventListener: (_type, listener) => listener({ loaded: 0.42 }) })
        return Promise.resolve({
          translate: vi.fn().mockReturnValue(translation.promise),
          destroy: vi.fn(),
        })
      },
    )
  vi.stubGlobal('Translator', { create })
  render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={new Map()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText(readerEn.translationSource), { target: { value: 'fr' } })
  fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'en' } })
  fireEvent.click(screen.getByRole('button', { name: readerEn.translate }))
  const progress = await screen.findByRole('progressbar')
  expect(progress.getAttribute('value')).toBe('42')
  expect(timeout).toHaveBeenCalledWith(5 * 60_000)
  translation.resolve('An experiment')
  await screen.findByText('An experiment')
  expect(screen.queryByRole('progressbar')).toBeNull()
})

it('aborts an outstanding translation when the panel closes', () => {
  const pending = deferred<never>()
  const create = vi.fn((_options: { signal: AbortSignal }) => pending.promise)
  vi.stubGlobal('Translator', { create })
  const { unmount } = render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={new Map()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText(readerEn.translationSource), { target: { value: 'fr' } })
  fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'en' } })
  fireEvent.click(screen.getByRole('button', { name: readerEn.translate }))
  const signal = create.mock.calls[0]?.[0].signal
  expect(signal?.aborted).toBe(false)
  unmount()
  expect(signal?.aborted).toBe(true)
  pending.reject(signal?.reason)
})

it('offers a Composer request in the chosen language when the browser translator is absent', () => {
  vi.stubGlobal('Translator', undefined)
  const onModelRequest = vi.fn(() => true)
  const onClose = vi.fn()
  render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={new Map()}
      onClose={onClose}
      onModelRequest={onModelRequest}
    />,
  )
  expect(screen.queryByRole('button', { name: readerEn.translate })).toBeNull()
  fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'ja' } })
  fireEvent.click(screen.getByRole('button', { name: readerEn.translateInChat }))
  expect(onModelRequest).toHaveBeenCalledExactlyOnceWith('Japanese')
  expect(onClose).toHaveBeenCalledOnce()
})

it('sends just the excerpt to the session model after an explicit click and displays both texts', async () => {
  vi.stubGlobal('Translator', undefined)
  const cache = new Map<string, string>()
  const modelTranslation = vi.fn().mockResolvedValue('実験')
  render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={cache}
      onClose={vi.fn()}
      modelTranslation={modelTranslation}
    />,
  )
  fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'ja' } })
  expect(modelTranslation).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: readerEn.translationModel }))
  expect(await screen.findByText('実験')).toBeTruthy()
  expect(screen.getByText(text)).toBeTruthy()
  expect(modelTranslation).toHaveBeenCalledExactlyOnceWith(text, 'ja', expect.any(AbortSignal))
  expect(cache.size).toBe(0)
})

it('rejects an empty model response and lets the user retry and review a complete translation', async () => {
  vi.stubGlobal('Translator', undefined)
  const translate = vi.fn().mockResolvedValueOnce('  ').mockResolvedValueOnce('An experiment')
  const onQuote = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
  const onClose = vi.fn()
  render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={new Map()}
      onClose={onClose}
      onQuote={onQuote}
      modelTranslation={translate}
    />,
  )
  const model = screen.getByRole('button', { name: readerEn.translationModel })
  fireEvent.click(model)
  await screen.findByText(readerEn.translationFailed)
  expect(screen.queryByRole('button', { name: readerEn.translationQuote })).toBeNull()

  fireEvent.click(model)
  await screen.findByText('An experiment')
  const quote = screen.getByRole('button', { name: readerEn.translationQuote })
  fireEvent.click(quote)
  expect(screen.getByText(readerEn.quoteFailed)).toBeTruthy()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(quote)
  expect(onClose).toHaveBeenCalledOnce()
  expect(translate).toHaveBeenCalledTimes(2)
})

it('bounds local translations and evicts only the oldest cached excerpt when the cache is full', async () => {
  const reply = vi.fn().mockResolvedValue('An experiment')
  const destroy = vi.fn()
  vi.stubGlobal('Translator', { create: vi.fn().mockResolvedValue({ translate: reply, destroy }) })
  const cache = new Map(Array.from({ length: 12 }, (_, index) => [String(index), 'Earlier text']))
  render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={cache}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText(readerEn.translationSource), { target: { value: 'fr' } })
  fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'en' } })
  fireEvent.click(screen.getByRole('button', { name: readerEn.translate }))
  await screen.findByText('An experiment')
  expect(cache.size).toBe(12)
  expect(cache.has('0')).toBe(false)
  expect(cache.get('1')).toBe('Earlier text')
  expect(cache.get(JSON.stringify(['fr', 'en', text]))).toBe('An experiment')
  expect(destroy).toHaveBeenCalledOnce()
})

it('reports a failed copy and omits quote/model actions when the reader provides none', async () => {
  const writeText = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, { language: { value: 'en-US' }, clipboard: { value: { writeText } } }),
  )
  vi.stubGlobal('Translator', {
    create: vi.fn().mockResolvedValue({
      translate: vi.fn().mockResolvedValue('An experiment'),
      destroy: vi.fn(),
    }),
  })
  render(
    <ReaderTranslation
      t={t}
      text={text}
      tabSignal={new AbortController().signal}
      cache={new Map()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText(readerEn.translationSource), { target: { value: 'fr' } })
  fireEvent.change(screen.getByLabelText(readerEn.translationTarget), { target: { value: 'en' } })
  fireEvent.click(screen.getByRole('button', { name: readerEn.translate }))
  expect(await screen.findByText('An experiment')).toBeTruthy()
  expect(screen.queryByRole('button', { name: readerEn.translationQuote })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: readerEn.translationCopy }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    readerEn.translationCopyFailed,
  )
})
