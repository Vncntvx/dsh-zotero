interface DisposableModel {
  destroy(): void
}

interface LanguageDetector extends DisposableModel {
  detect(
    text: string,
    options: { signal: AbortSignal },
  ): Promise<
    readonly {
      detectedLanguage: string
      confidence: number
    }[]
  >
}

interface Translator extends DisposableModel {
  translate(text: string, options: { signal: AbortSignal }): Promise<string>
}

interface BrowserTranslationApis {
  readonly LanguageDetector?: {
    create(options: {
      signal: AbortSignal
      monitor?: (monitor: DownloadMonitor) => void
    }): Promise<LanguageDetector>
  }
  readonly Translator?: {
    create(options: {
      sourceLanguage: string
      targetLanguage: string
      signal: AbortSignal
      monitor?: (monitor: DownloadMonitor) => void
    }): Promise<Translator>
  }
}

interface DownloadProgressEvent extends Event {
  readonly loaded: number
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: DownloadProgressEvent) => void): void
}

export interface ReaderTranslationProvider {
  translate(
    text: string,
    source: string,
    target: string,
    signal: AbortSignal,
    onDownloadProgress?: (percent: number | undefined) => void,
  ): Promise<string>
}

function progressMonitor(
  onProgress?: (percent: number | undefined) => void,
): ((monitor: DownloadMonitor) => void) | undefined {
  if (onProgress === undefined) return undefined
  return (download) => {
    download.addEventListener('downloadprogress', (event) => {
      onProgress(Math.max(0, Math.min(100, Math.floor(event.loaded * 100))))
    })
  }
}

export function browserTranslationProvider(
  apis: BrowserTranslationApis = globalThis as typeof globalThis & BrowserTranslationApis,
): ReaderTranslationProvider | undefined {
  const { LanguageDetector, Translator } = apis
  if (!Translator) return undefined
  return {
    async translate(text, source, target, signal, onDownloadProgress) {
      signal.throwIfAborted()
      let language = source
      if (source === 'auto') {
        if (!LanguageDetector) throw new Error('Language detection is unavailable.')
        const monitor = progressMonitor(onDownloadProgress)
        const detector = await LanguageDetector.create({
          signal,
          ...(monitor === undefined ? {} : { monitor }),
        })
        onDownloadProgress?.(undefined)
        try {
          const [best] = await detector.detect(text, { signal })
          if (!best || best.confidence < 0.5 || best.detectedLanguage === 'und')
            throw new Error('The source language could not be identified.')
          language = best.detectedLanguage
        } finally {
          detector.destroy()
        }
      }
      signal.throwIfAborted()
      if (language === target) return text
      const monitor = progressMonitor(onDownloadProgress)
      const translator = await Translator.create({
        sourceLanguage: language,
        targetLanguage: target,
        signal,
        ...(monitor === undefined ? {} : { monitor }),
      })
      onDownloadProgress?.(undefined)
      try {
        return await translator.translate(text, { signal })
      } finally {
        translator.destroy()
      }
    },
  }
}
