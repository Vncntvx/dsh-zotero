import { expect, it, vi } from 'vitest'
import { browserTranslationProvider } from '../../../src/client/reader/browser-translation.ts'

function fixture() {
  const detector = {
    detect: vi.fn().mockResolvedValue([{ detectedLanguage: 'fr', confidence: 0.96 }]),
    destroy: vi.fn(),
  }
  const translator = { translate: vi.fn().mockResolvedValue('An experiment'), destroy: vi.fn() }
  const apis = {
    LanguageDetector: { create: vi.fn().mockResolvedValue(detector) },
    Translator: { create: vi.fn().mockResolvedValue(translator) },
  }
  return { provider: browserTranslationProvider(apis)!, detector, translator, apis }
}

it('is absent when the browser has no translator', () => {
  expect(browserTranslationProvider({})).toBeUndefined()
})

it('detects the selected passage locally and disposes both models', async () => {
  const { provider, detector, translator, apis } = fixture()
  const signal = new AbortController().signal
  await expect(provider.translate('Une expérience', 'auto', 'en', signal)).resolves.toBe(
    'An experiment',
  )
  expect(detector.detect).toHaveBeenCalledExactlyOnceWith('Une expérience', { signal })
  expect(apis.Translator.create).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      sourceLanguage: 'fr',
      targetLanguage: 'en',
      signal,
    }),
  )
  expect(translator.translate).toHaveBeenCalledExactlyOnceWith('Une expérience', { signal })
  expect(detector.destroy).toHaveBeenCalledOnce()
  expect(translator.destroy).toHaveBeenCalledOnce()
})

it('reports bounded model-download progress for detection and translation', async () => {
  const { provider, apis } = fixture()
  const onProgress = vi.fn()
  const signal = new AbortController().signal
  await provider.translate('Une expérience', 'auto', 'en', signal, onProgress)
  const detectorMonitor = apis.LanguageDetector.create.mock.calls[0]?.[0].monitor
  const translatorMonitor = apis.Translator.create.mock.calls[0]?.[0].monitor
  detectorMonitor?.({
    addEventListener: (
      _type: 'downloadprogress',
      listener: (event: Event & { loaded: number }) => void,
    ) => listener({ loaded: 0.4 } as Event & { loaded: number }),
  })
  translatorMonitor?.({
    addEventListener: (
      _type: 'downloadprogress',
      listener: (event: Event & { loaded: number }) => void,
    ) => listener({ loaded: 1.2 } as Event & { loaded: number }),
  })
  expect(onProgress.mock.calls).toEqual([[undefined], [undefined], [40], [100]])
})

it('offers manual language selection when detection is unavailable or uncertain', async () => {
  const { provider, detector, apis } = fixture()
  detector.detect.mockResolvedValue([])
  const signal = new AbortController().signal
  await expect(provider.translate('Une expérience', 'auto', 'en', signal)).rejects.toThrow(
    'identified',
  )
  expect(apis.Translator.create).not.toHaveBeenCalled()
  expect(detector.destroy).toHaveBeenCalledOnce()
  await expect(provider.translate('Une expérience', 'fr', 'en', signal)).resolves.toBe(
    'An experiment',
  )
})

it('releases the translator even when the passage fails to translate', async () => {
  const { provider, translator } = fixture()
  translator.translate.mockRejectedValue(new Error('Language pair unavailable'))
  await expect(
    provider.translate('Une expérience', 'fr', 'en', new AbortController().signal),
  ).rejects.toThrow('unavailable')
  expect(translator.destroy).toHaveBeenCalledOnce()
})

it('returns the passage when the chosen languages match', async () => {
  const { provider, apis } = fixture()
  await expect(
    provider.translate('Une expérience', 'fr', 'fr', new AbortController().signal),
  ).resolves.toBe('Une expérience')
  expect(apis.Translator.create).not.toHaveBeenCalled()
})
