import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { messageOf } from '../error-text.ts'
import css from './reader.module.css'

export function AnnotationComment({
  t,
  signal,
  suggest,
}: PropsLocale<'zoteroReader'> & {
  signal: AbortSignal
  suggest?: (signal: AbortSignal) => Promise<string>
}) {
  const [comment, setComment] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const request = useRef<AbortController | undefined>(undefined)
  const enabled = suggest !== undefined
  useEffect(() => {
    if (!enabled || signal.aborted) {
      setPending(false)
      setSuggestion('')
      setError(undefined)
    }
    return () => request.current?.abort()
  }, [enabled, signal])

  return (
    <>
      <label>
        {t('annotationComment')}{' '}
        <textarea
          className={css.field}
          name="comment"
          rows={2}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      {suggest && !suggestion && (
        <Button
          size="sm"
          type="button"
          disabled={pending}
          onClick={async () => {
            if (signal.aborted || pending) return
            const controller = new AbortController()
            request.current = controller
            const scope = AbortSignal.any([signal, controller.signal])
            setPending(true)
            setError(undefined)
            try {
              const text = await suggest(scope)
              if (!scope.aborted) setSuggestion(text)
            } catch (cause) {
              if (!scope.aborted) setError(messageOf(cause))
            } finally {
              if (!scope.aborted) setPending(false)
            }
          }}
        >
          {t(pending ? 'annotationSuggesting' : 'annotationSuggest')}
        </Button>
      )}
      {suggest && error && (
        <span role="alert">{t('annotationSuggestionFailed', { message: error })}</span>
      )}
      {suggest && suggestion && (
        <div className={css.controls} role="group" aria-label={t('annotationSuggestion')}>
          <p aria-live="polite">
            {t('annotationSuggestion')} {suggestion}
          </p>
          <Button
            size="sm"
            type="button"
            onClick={() => {
              setComment(suggestion)
              setSuggestion('')
            }}
          >
            {t('annotationUseSuggestion')}
          </Button>
          <Button size="sm" type="button" onClick={() => setSuggestion('')}>
            {t('annotationDiscardSuggestion')}
          </Button>
        </div>
      )}
    </>
  )
}
