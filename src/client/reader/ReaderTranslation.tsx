import { useContext, useEffect, useRef, useState } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ZOTERO_READER_TRANSLATION_LANGUAGES as LANGUAGE_CODES,
  ZOTERO_READER_TRANSLATION_RESULT_CHARS,
  ZOTERO_READER_TRANSLATION_SOURCE_CHARS,
} from '../../constants.ts'
import { browserTranslationProvider } from './browser-translation.ts'
import { useReturnFocus } from './return-focus.ts'
import css from './reader.module.css'
import { ReaderTranslationTargetContext } from './translation-preferences.ts'

type TargetLanguage = (typeof LANGUAGE_CODES)[number]

export interface ReaderTranslationResult {
  readonly text: string
  readonly target: TargetLanguage
  readonly engine: 'browser' | 'model'
}

interface ReaderTranslationProps extends PropsLocale<'zoteroReader'> {
  readonly text: string
  readonly tabSignal: AbortSignal
  readonly cache: Map<string, string>
  readonly onClose: () => void
  readonly onQuote?: (translated: ReaderTranslationResult) => boolean
  readonly onModelRequest?: (language: string) => boolean
  readonly modelTranslation?: (
    text: string,
    target: TargetLanguage,
    signal: AbortSignal,
  ) => Promise<string>
}

export function ReaderTranslation({
  t,
  text,
  tabSignal,
  cache,
  onClose,
  onQuote,
  onModelRequest,
  modelTranslation,
}: ReaderTranslationProps) {
  useReturnFocus()
  const preferredTarget = useContext(ReaderTranslationTargetContext)
  const [source, setSource] = useState('auto')
  const [target, setTarget] = useState<TargetLanguage>(() =>
    preferredTarget === 'auto'
      ? navigator.language.toLowerCase().startsWith('zh')
        ? 'zh'
        : 'en'
      : (LANGUAGE_CODES.find((language) => language === preferredTarget) ?? 'en'),
  )
  const [result, setResult] = useState<ReaderTranslationResult>()
  const [pending, setPending] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number>()
  const [notice, setNotice] = useState<
    'translationFailed' | 'translationCopied' | 'translationCopyFailed' | 'quoteFailed'
  >()
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [])
  const languages = new Intl.DisplayNames([navigator.language], { type: 'language' })
  const provider = browserTranslationProvider()

  const translate = async (engine: 'browser' | 'model') => {
    if (request.current || tabSignal.aborted) return
    const run:
      | ((
          signal: AbortSignal,
          onProgress: (percent: number | undefined) => void,
        ) => Promise<string>)
      | undefined =
      engine === 'browser' && provider
        ? (signal: AbortSignal, onProgress: (percent: number | undefined) => void) =>
            provider.translate(text, source, target, signal, onProgress)
        : engine === 'model' &&
            modelTranslation &&
            text.length <= ZOTERO_READER_TRANSLATION_SOURCE_CHARS
          ? (signal: AbortSignal) => modelTranslation(text, target, signal)
          : undefined
    if (!run) return
    const key = engine === 'browser' ? JSON.stringify([source, target, text]) : undefined
    setNotice(undefined)
    const existing = key === undefined ? undefined : cache.get(key)
    if (existing !== undefined) {
      setResult({ text: existing, target, engine })
      return
    }
    const controller = new AbortController()
    request.current = controller
    const scope = AbortSignal.any([tabSignal, controller.signal])
    const timeout = engine === 'browser' ? 5 * 60_000 : 30_000
    const signal = AbortSignal.any([scope, AbortSignal.timeout(timeout)])
    setPending(true)
    setDownloadProgress(undefined)
    setResult(undefined)
    try {
      const translated = await run(signal, setDownloadProgress)
      signal.throwIfAborted()
      if (!translated.trim() || translated.length > ZOTERO_READER_TRANSLATION_RESULT_CHARS)
        throw new Error('Invalid translation.')
      if (key !== undefined) {
        if (cache.size >= 12) {
          const oldest = cache.keys().next().value
          if (oldest !== undefined) cache.delete(oldest)
        }
        cache.set(key, translated)
      }
      setResult({ text: translated, target, engine })
    } catch {
      if (!scope.aborted) setNotice('translationFailed')
    } finally {
      request.current = undefined
      setDownloadProgress(undefined)
      if (!scope.aborted) setPending(false)
    }
  }

  return (
    <section className={css.translation} aria-label={t('translation')}>
      {provider && <p>{t('translationLocal')}</p>}
      <div className={css.controls}>
        {provider && (
          <label className={css.fieldLabel}>
            {t('translationSource')}
            <select
              className={css.field}
              value={source}
              disabled={pending}
              onChange={(event) => {
                setSource(event.target.value)
                setResult(undefined)
                setNotice(undefined)
              }}
            >
              <option value="auto">{t('translationAuto')}</option>
              {LANGUAGE_CODES.map((code) => (
                <option key={code} value={code}>
                  {languages.of(code)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={css.fieldLabel}>
          {t('translationTarget')}
          <select
            className={css.field}
            value={target}
            disabled={pending}
            onChange={(event) => {
              const language = LANGUAGE_CODES.find((code) => code === event.target.value)
              if (!language) return
              setTarget(language)
              setResult(undefined)
              setNotice(undefined)
            }}
          >
            {LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {languages.of(code)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={css.controls}>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        {provider && (
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => void translate('browser')}
          >
            {t('translate')}
          </Button>
        )}
        {modelTranslation && (
          <Button
            size="sm"
            variant={provider ? 'ghost' : 'primary'}
            disabled={pending || text.length > ZOTERO_READER_TRANSLATION_SOURCE_CHARS}
            onClick={() => void translate('model')}
          >
            {t('translationModel')}
          </Button>
        )}
        {onModelRequest && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (onModelRequest(languages.of(target) ?? target)) onClose()
              else setNotice('quoteFailed')
            }}
          >
            {t('translateInChat')}
          </Button>
        )}
      </div>
      {pending && <p role="status">{t('translationPending')}</p>}
      {downloadProgress !== undefined && (
        <div
          role="status"
          aria-label={t('translationDownloadProgress', { percent: downloadProgress })}
        >
          <span>{t('translationDownloadProgress', { percent: downloadProgress })}</span>
          <progress max={100} value={downloadProgress} />
        </div>
      )}
      {modelTranslation && text.length > ZOTERO_READER_TRANSLATION_SOURCE_CHARS && (
        <p role="status">
          {t('translationModelLimit', { count: ZOTERO_READER_TRANSLATION_SOURCE_CHARS })}
        </p>
      )}
      {notice && <p role={notice === 'translationCopied' ? 'status' : 'alert'}>{t(notice)}</p>}
      {result !== undefined && (
        <>
          <div className={css.translationText}>
            <div>
              <h4 className={css.detailsHeading}>{t('translationOriginal')}</h4>
              <p>{text}</p>
            </div>
            <div>
              <h4 className={css.detailsHeading}>{t('translationResult')}</h4>
              <p>{result.text}</p>
            </div>
          </div>
          <div className={css.controls}>
            <Button
              size="sm"
              onClick={() => {
                void writeClipboard(result.text).then(
                  (copied) => setNotice(copied ? 'translationCopied' : 'translationCopyFailed'),
                  () => setNotice('translationCopyFailed'),
                )
              }}
            >
              {t('translationCopy')}
            </Button>
            {onQuote && (
              <Button
                size="sm"
                onClick={() => {
                  if (onQuote(result)) onClose()
                  else setNotice('quoteFailed')
                }}
              >
                {t('translationQuote')}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
