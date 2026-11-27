import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ZoteroArtifactRegionTextView } from '../../contract.ts'
import type { PdfPageRegion, PdfQuoteSource, PdfRect } from '../../reader/evidence.ts'
import { downloadBlob } from '../download.ts'
import type { PdfCapture } from './pdf-capture.ts'
import { useReturnFocus } from './return-focus.ts'
import css from './reader.module.css'

const FAILURE_NOTICES = new Set([
  'captureFailed',
  'captureInvalidRegion',
  'copyFailed',
  'captureQuoteFailed',
  'parsedMissing',
  'parsedOpenFailed',
  'captureParsedEmpty',
  'captureParsedFailed',
])

interface ReaderCaptureProps extends PropsLocale<'zoteroReader'> {
  readonly defaultIncludeSource?: boolean
  readonly tabSignal: AbortSignal
  readonly capture: (
    region: PdfRect,
    signal: AbortSignal,
    sourceTitle?: string,
  ) => Promise<PdfCapture>
  readonly source: PdfQuoteSource
  readonly inputActions?: Pick<InputActions, 'insertQuote' | 'persistDraft'>
  readonly locateInParsed?: (
    pages: readonly PdfPageRegion[],
    quote: string | undefined,
    signal: AbortSignal,
  ) => Promise<boolean>
  readonly readParsedText?: (
    pages: readonly PdfPageRegion[],
    signal: AbortSignal,
  ) => Promise<ZoteroArtifactRegionTextView | undefined>
  readonly onClose: () => void
}

function regionOf(start: { x: number; y: number }, end: { x: number; y: number }): PdfRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  }
}

function inside(node: HTMLElement, x: number, y: number) {
  const { left, right, top, bottom } = node.getBoundingClientRect()
  return { x: Math.min(right, Math.max(left, x)), y: Math.min(bottom, Math.max(top, y)) }
}

export function ReaderCapture({
  t,
  defaultIncludeSource = false,
  tabSignal,
  capture,
  source,
  inputActions,
  locateInParsed,
  readParsedText,
  onClose,
}: ReaderCaptureProps) {
  useReturnFocus()
  const surface = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; y: number }>()
  const request = useRef<AbortController>()
  const parsedRequest = useRef<AbortController>()
  const locateRequest = useRef<AbortController>()
  const [region, setRegion] = useState<PdfRect>()
  const [preview, setPreview] = useState<PdfCapture>()
  const [url, setUrl] = useState<string>()
  const [pending, setPending] = useState(false)
  const [parsedPending, setParsedPending] = useState(false)
  const [locating, setLocating] = useState(false)
  const [parsedText, setParsedText] = useState<ZoteroArtifactRegionTextView>()
  const [includeSource, setIncludeSource] = useState(defaultIncludeSource)
  const [percent, setPercent] = useState({ left: '10', top: '10', width: '80', height: '80' })
  const [notice, setNotice] = useState<
    | 'captureFailed'
    | 'captureInvalidRegion'
    | 'captureSourceCopied'
    | 'captureTextCopied'
    | 'captureImageCopied'
    | 'copyFailed'
    | 'captureQuoteAdded'
    | 'captureQuoteFailed'
    | 'parsedMissing'
    | 'parsedOpenFailed'
    | 'captureParsedEmpty'
    | 'captureParsedFailed'
  >()

  useEffect(() => {
    surface.current?.focus()
    return () => request.current?.abort()
  }, [])
  useEffect(() => {
    if (!preview) return
    const previewUrl = URL.createObjectURL(preview.png)
    setUrl(previewUrl)
    surface.current?.focus()
    return () => URL.revokeObjectURL(previewUrl)
  }, [preview])
  const canLocateInParsed = locateInParsed !== undefined
  useEffect(() => {
    setLocating(false)
    return () => {
      locateRequest.current?.abort()
      locateRequest.current = undefined
    }
  }, [canLocateInParsed, tabSignal])
  const canReadParsedText = readParsedText !== undefined
  useEffect(() => {
    setParsedPending(false)
    setParsedText(undefined)
    return () => {
      parsedRequest.current?.abort()
      parsedRequest.current = undefined
    }
  }, [canReadParsedText, tabSignal])

  const extractParsedText = async () => {
    if (!preview || !readParsedText || parsedRequest.current || tabSignal.aborted) return
    const controller = new AbortController()
    parsedRequest.current = controller
    const signal = AbortSignal.any([controller.signal, tabSignal])
    setParsedPending(true)
    setNotice(undefined)
    try {
      const text = await readParsedText(preview.regions, signal)
      if (signal.aborted) return
      if (text) setParsedText(text)
      else setNotice('captureParsedEmpty')
    } catch {
      if (!signal.aborted) setNotice('captureParsedFailed')
    } finally {
      if (parsedRequest.current === controller) {
        parsedRequest.current = undefined
        setParsedPending(false)
      }
    }
  }

  const renderCapture = async (selection: PdfRect) => {
    if (request.current || tabSignal.aborted) return
    const controller = new AbortController()
    request.current = controller
    const scope = AbortSignal.any([controller.signal, tabSignal])
    setPending(true)
    setNotice(undefined)
    try {
      const image = await capture(
        selection,
        AbortSignal.any([scope, AbortSignal.timeout(20_000)]),
        includeSource ? source.title : undefined,
      )
      if (!scope.aborted) setPreview(image)
    } catch {
      if (!scope.aborted) setNotice('captureFailed')
    } finally {
      request.current = undefined
      if (!scope.aborted) {
        setPending(false)
        setRegion(undefined)
      }
    }
  }

  const captureFromFields = () => {
    const box = overlay.current?.getBoundingClientRect()
    if (!box) return
    const left = Math.min(100, Math.max(0, Number(percent.left)))
    const top = Math.min(100, Math.max(0, Number(percent.top)))
    const width = Math.min(100 - left, Math.max(0, Number(percent.width)))
    const height = Math.min(100 - top, Math.max(0, Number(percent.height)))
    if (![left, top, width, height].every(Number.isFinite)) {
      setNotice('captureInvalidRegion')
      return
    }
    const selection = {
      x: box.left + (box.width * left) / 100,
      y: box.top + (box.height * top) / 100,
      width: (box.width * width) / 100,
      height: (box.height * height) / 100,
    }
    if (selection.width < 4 || selection.height < 4) {
      setNotice('captureInvalidRegion')
      return
    }
    setRegion(selection)
    void renderCapture(selection)
  }

  const copy = (text: string, done: 'captureSourceCopied' | 'captureTextCopied') => {
    void writeClipboard(text).then(
      (copied) => setNotice(copied ? done : 'copyFailed'),
      () => setNotice('copyFailed'),
    )
  }
  const pageNumbers = preview?.regions.map(({ pageIndex }) => pageIndex + 1) ?? []
  const pages = pageNumbers.join(', ')
  const extracted = canReadParsedText ? parsedText : undefined
  const sourceRecord = {
    ...source,
    sourceType: 'screenshot',
    pages: preview?.regions,
    ...(extracted && { textSource: 'cached-mineru', textIncomplete: extracted.incomplete }),
  }
  const excerptText = extracted?.text ?? preview?.text
  const incomplete = extracted?.incomplete ?? preview?.textIncomplete
  const clipboard =
    typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function'
      ? navigator.clipboard
      : undefined
  const quoteCapture = () => {
    if (!preview || !inputActions || tabSignal.aborted) return
    const detail = t('selectionPages', { pages })
    const citation = t('quoteSource', { ref: source.attachmentRef, pages })
    const excerpt = [
      extracted && t('captureParsedText'),
      excerptText,
      incomplete && t('captureTextIncomplete'),
    ]
      .filter(Boolean)
      .join('\n\n')
    const draft = [citation, excerpt, JSON.stringify(sourceRecord)].filter(Boolean).join('\n\n')
    if (
      !inputActions.insertQuote(draft, {
        label: t('capture'),
        title: source.title,
        detail,
        body: excerpt || citation,
      })
    ) {
      setNotice('captureQuoteFailed')
      return
    }
    inputActions.persistDraft()
    setNotice('captureQuoteAdded')
  }

  return (
    <div
      ref={surface}
      className={css.capture}
      role="dialog"
      aria-modal="true"
      aria-label={t('capture')}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key !== 'Tab') return
        const items = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((item) => !item.hasAttribute('disabled'))
        if (items.length === 0) {
          event.preventDefault()
          surface.current?.focus()
          return
        }
        const first = items[0]!
        const last = items.at(-1)!
        const active = document.activeElement
        if (event.shiftKey && (active === first || active === surface.current)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || active === surface.current)) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      {!preview && (
        <div
          ref={overlay}
          className={css.captureSurface}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary || request.current) return
            const { pointerId, clientX: x, clientY: y } = event
            event.currentTarget.setPointerCapture(pointerId)
            drag.current = { pointer: pointerId, x, y }
            setRegion(undefined)
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (start?.pointer !== event.pointerId) return
            setRegion(regionOf(start, inside(event.currentTarget, event.clientX, event.clientY)))
          }}
          onPointerUp={(event) => {
            const start = drag.current
            if (start?.pointer !== event.pointerId) return
            drag.current = undefined
            const selected = regionOf(
              start,
              inside(event.currentTarget, event.clientX, event.clientY),
            )
            if (selected.width >= 4 && selected.height >= 4) void renderCapture(selected)
            else setRegion(undefined)
          }}
          onLostPointerCapture={() => {
            if (!drag.current) return
            drag.current = undefined
            setRegion(undefined)
          }}
        >
          {region && (
            <span
              aria-hidden="true"
              className={css.captureRegion}
              style={{
                left: region.x - (surface.current?.getBoundingClientRect().left ?? 0),
                top: region.y - (surface.current?.getBoundingClientRect().top ?? 0),
                width: region.width,
                height: region.height,
              }}
            />
          )}
        </div>
      )}
      <div className={css.capturePanel}>
        {preview && url ? (
          <>
            <p>
              {source.title} · {t('selectionPages', { pages })}
            </p>
            <img className={css.capturePreview} src={url} alt={t('capturePreview')} />
            {excerptText && (
              <details className={css.disclosure} open={extracted ? true : undefined}>
                <summary>{t(extracted ? 'captureParsedText' : 'captureText')}</summary>
                <p className={css.detailsText}>{excerptText}</p>
              </details>
            )}
            {incomplete && <p>{t('captureTextIncomplete')}</p>}
            <div className={css.controls}>
              <Button size="sm" variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  downloadBlob(
                    preview.png,
                    `zotero-pages-${pageNumbers.join('-')}.png`,
                    'image/png',
                  )
                }
              >
                {t('captureSave')}
              </Button>
              <Button
                size="sm"
                onClick={() => copy(JSON.stringify(sourceRecord, null, 2), 'captureSourceCopied')}
              >
                {t('captureCopySource')}
              </Button>
              {clipboard && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await clipboard.write([new ClipboardItem({ 'image/png': preview.png })])
                      if (!tabSignal.aborted) setNotice('captureImageCopied')
                    } catch {
                      if (!tabSignal.aborted) setNotice('copyFailed')
                    }
                  }}
                >
                  {t('captureCopyImage')}
                </Button>
              )}
              {excerptText && (
                <Button size="sm" onClick={() => copy(excerptText, 'captureTextCopied')}>
                  {t('captureCopyText')}
                </Button>
              )}
              {canReadParsedText && !extracted && (preview.textIncomplete || !preview.text) && (
                <Button size="sm" disabled={parsedPending} onClick={() => void extractParsedText()}>
                  {t(parsedPending ? 'captureParsedLoading' : 'captureExtractParsed')}
                </Button>
              )}
              {locateInParsed && preview.regions.length === 1 && (
                <Button
                  size="sm"
                  disabled={locating}
                  onClick={async () => {
                    if (locateRequest.current || tabSignal.aborted) return
                    const controller = new AbortController()
                    locateRequest.current = controller
                    const signal = AbortSignal.any([tabSignal, controller.signal])
                    setLocating(true)
                    setNotice(undefined)
                    try {
                      const opened = await locateInParsed(
                        preview.regions,
                        preview.textIncomplete ? undefined : preview.text,
                        signal,
                      )
                      if (signal.aborted) return
                      if (opened) onClose()
                      else setNotice('parsedMissing')
                    } catch {
                      if (!signal.aborted) setNotice('parsedOpenFailed')
                    } finally {
                      if (locateRequest.current === controller) {
                        locateRequest.current = undefined
                        setLocating(false)
                      }
                    }
                  }}
                >
                  {t('locateInParsed')}
                </Button>
              )}
              {inputActions && (
                <Button size="sm" variant="primary" onClick={quoteCapture}>
                  {t('captureQuote')}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p role="status">{t(pending ? 'capturePending' : 'captureInstructions')}</p>
            <form
              className={css.captureForm}
              aria-label={t('captureRegionTitle')}
              onSubmit={(event) => {
                event.preventDefault()
                captureFromFields()
              }}
            >
              <p className={css.captureLegend}>{t('captureRegionTitle')}</p>
              <div className={css.captureFields}>
                {(['left', 'top', 'width', 'height'] as const).map((field) => (
                  <label className={css.fieldLabel} key={field}>
                    {t(
                      field === 'left'
                        ? 'captureLeft'
                        : field === 'top'
                          ? 'captureTop'
                          : field === 'width'
                            ? 'captureWidth'
                            : 'captureHeight',
                    )}
                    <input
                      className={css.field}
                      type="number"
                      required
                      min={0}
                      max={100}
                      step={1}
                      value={percent[field]}
                      disabled={pending}
                      onChange={(event) =>
                        setPercent((current) => ({ ...current, [field]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              <Button size="sm" variant="primary" type="submit" disabled={pending}>
                {t('captureApply')}
              </Button>
            </form>
            <Checkbox
              checked={includeSource}
              disabled={pending}
              label={t('captureIncludeSource')}
              onChange={setIncludeSource}
            />
            <Button size="sm" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
          </>
        )}
        {notice && <p role={FAILURE_NOTICES.has(notice) ? 'alert' : 'status'}>{t(notice)}</p>}
      </div>
    </div>
  )
}
