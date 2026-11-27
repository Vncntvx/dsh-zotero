import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { downloadBlob } from '../download.ts'
import type { excerptRegion } from './excerpt-region.ts'
import css from './reader.module.css'

const WIDTH = 960
const MARGIN = 28
const LINE_HEIGHT = 29
const MAX_LINES = 100

function makeExcerptPng(text: string, title: string, omitted: string) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  const font = '20px system-ui'
  context.font = font
  const lines: string[] = []
  const fit = WIDTH - 2 * MARGIN
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = ''
    for (const { segment } of segments.segment(paragraph)) {
      if (context.measureText(line + segment).width > fit) {
        lines.push(line)
        line = ''
      }
      line += segment
      if (lines.length >= MAX_LINES) break
    }
    if (lines.length >= MAX_LINES) break
    lines.push(line)
  }
  if (lines.length >= MAX_LINES) lines[MAX_LINES - 1] = omitted
  canvas.width = WIDTH
  canvas.height = 2 * MARGIN + LINE_HEIGHT * (lines.length + 2)
  context.fillStyle = '#fff'
  context.fillRect(0, 0, WIDTH, canvas.height)
  context.fillStyle = '#161616'
  context.textBaseline = 'top'
  context.font = 'bold 23px system-ui'
  context.fillText(title, MARGIN, MARGIN, fit)
  context.font = font
  for (const [index, line] of lines.entries()) {
    context.fillText(line, MARGIN, MARGIN + LINE_HEIGHT * (index + 2), fit)
  }
  return canvasPng(canvas)
}

function canvasPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not encode the excerpt.'))
    }, 'image/png')
  }).finally(() => {
    canvas.width = canvas.height = 0
  })
}

async function makeRegionPng(
  region: NonNullable<ReturnType<typeof excerptRegion>>,
  signal: AbortSignal,
) {
  const image = new Image()
  image.src = region.src
  await image.decode()
  signal.throwIfAborted()
  const canvas = document.createElement('canvas')
  canvas.width = region.width
  canvas.height = region.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable.')
  context.fillStyle = region.background || '#fff'
  context.fillRect(0, 0, region.width, region.height)
  context.drawImage(image, 0, 0)
  return await canvasPng(canvas)
}

interface Props extends PropsLocale<'zoteroReader'> {
  readonly title: string
  readonly text: string
  readonly region?: ReturnType<typeof excerptRegion>
  readonly tabSignal: AbortSignal
  readonly onQuote?: () => boolean
  readonly onClose: () => void
}

export function ReaderExcerptCapture({
  t,
  title,
  text,
  region,
  tabSignal,
  onQuote,
  onClose,
}: Props) {
  const surface = useRef<HTMLElement>(null)
  const [preview, setPreview] = useState<{ png: Blob; url: string; layout: boolean }>()
  const [notice, setNotice] = useState<'captureFailed' | 'captureImageCopied' | 'copyFailed'>()
  const omitted = t('quoteBatchTruncated')
  useEffect(() => surface.current?.focus(), [])
  useEffect(() => {
    const owner = new AbortController()
    const signal = AbortSignal.any([tabSignal, owner.signal])
    let url: string | undefined
    void Promise.resolve()
      .then(async () => {
        signal.throwIfAborted()
        const visual = region && (await makeRegionPng(region, signal).catch(() => undefined))
        signal.throwIfAborted()
        return {
          png: visual ?? (await makeExcerptPng(text, title, omitted)),
          layout: Boolean(visual),
        }
      })
      .then(({ png, layout }) => {
        if (signal.aborted) return
        url = URL.createObjectURL(png)
        setPreview({ png, url, layout })
      })
      .catch(() => {
        if (!signal.aborted) setNotice('captureFailed')
      })
    return () => {
      owner.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [tabSignal, text, title, omitted, region])
  const clipboard =
    typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function'
      ? navigator.clipboard
      : undefined
  return (
    <section
      ref={surface}
      aria-label={t('documentCapture')}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose()
      }}
    >
      {preview && (
        <>
          <img className={css.capturePreview} src={preview.url} alt={t('documentCapturePreview')} />
          {!preview.layout && <p role="status">{t('documentCaptureTextFallback')}</p>}
          <div className={css.controls}>
            <Button
              size="sm"
              onClick={() => downloadBlob(preview.png, 'zotero-excerpt.png', 'image/png')}
            >
              {t('captureSave')}
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
            {onQuote && (
              <Button size="sm" onClick={onQuote}>
                {t('captureQuote')}
              </Button>
            )}
          </div>
        </>
      )}
      {!preview && !notice && <p role="status">{t('capturePending')}</p>}
      {notice && <p role="status">{t(notice)}</p>}
      <Button size="sm" onClick={onClose}>
        {t('cancel')}
      </Button>
    </section>
  )
}
