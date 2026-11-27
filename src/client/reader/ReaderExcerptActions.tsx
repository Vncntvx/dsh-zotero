import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ZOTERO_READER_TRANSLATION_SOURCE_CHARS } from '../../constants.ts'
import { browserTranslationProvider } from './browser-translation.ts'
import { excerptPrefix } from './pdf-excerpt.ts'
import { excerptRegion } from './excerpt-region.ts'
import { ReaderExcerptCapture } from './ReaderExcerptCapture.tsx'
import { ReaderTranslation, type ReaderTranslationResult } from './ReaderTranslation.tsx'
import css from './reader.module.css'

export interface ReaderTextSelection {
  readonly text: string
  readonly start: number
  readonly truncated: boolean
}

interface Props extends PropsLocale<'zoteroReader'> {
  readonly body: RefObject<HTMLDivElement>
  readonly title: string
  readonly tabSignal: AbortSignal
  readonly translate?: Parameters<typeof ReaderTranslation>[0]['modelTranslation']
  readonly onQuote?: (
    selection: ReaderTextSelection,
    result?: ReaderTranslationResult,
    screenshot?: boolean,
  ) => boolean
}

export function ReaderExcerptActions({ t, body, title, tabSignal, translate, onQuote }: Props) {
  const [selected, setSelected] = useState<ReaderTextSelection>()
  const [anchor, setAnchor] = useState<{
    left: number
    top: number
    bottom: number
    above: boolean
  }>()
  const [translating, setTranslating] = useState<ReaderTextSelection>()
  const [capturing, setCapturing] = useState<{
    selection: ReaderTextSelection
    region?: ReturnType<typeof excerptRegion>
  }>()
  const [notice, setNotice] = useState<
    'copied' | 'copyFailed' | 'quoteInsertFailed' | 'quoteBatchAdded'
  >()
  const cache = useRef(new Map<string, string>())
  const selectedRange = useRef<Range>()

  useEffect(() => {
    const root = body.current
    if (!root || tabSignal.aborted) return
    const select = () => {
      if (tabSignal.aborted) return
      selectedRange.current = undefined
      const selection = root.ownerDocument.getSelection()
      if (!selection?.rangeCount || selection.isCollapsed) return setSelected(undefined)
      const range = selection.getRangeAt(0)
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer))
        return setSelected(undefined)
      const raw = range.toString()
      if (!raw.trim()) return setSelected(undefined)
      const text = excerptPrefix(raw, ZOTERO_READER_TRANSLATION_SOURCE_CHARS)
      const prefix = range.cloneRange()
      selectedRange.current = range.cloneRange()
      prefix.selectNodeContents(root)
      prefix.setEnd(range.startContainer, range.startOffset)
      setSelected({ text, start: prefix.toString().length, truncated: raw.length > text.length })
      const box = range.getBoundingClientRect()
      setAnchor({
        left: box.left + box.width / 2,
        top: box.top,
        bottom: box.bottom,
        above: window.innerHeight - box.bottom < 120,
      })
      setNotice(undefined)
    }
    root.ownerDocument.addEventListener('selectionchange', select)
    return () => root.ownerDocument.removeEventListener('selectionchange', select)
  }, [body, tabSignal])

  const quote: Props['onQuote'] =
    onQuote &&
    ((selection, result, screenshot) => {
      const added = onQuote(selection, result, screenshot)
      if (!tabSignal.aborted) setNotice(added ? 'quoteBatchAdded' : 'quoteInsertFailed')
      return added
    })

  return (
    <>
      {selected && !translating && !capturing && (
        <div
          className={css.selectionBar}
          role="group"
          aria-label={t('documentSelection')}
          data-side={anchor?.above ? 'above' : undefined}
          style={{
            left: Math.min(window.innerWidth - 8, Math.max(8, anchor?.left ?? 8)),
            top: anchor?.above ? anchor.top : (anchor?.bottom ?? 0),
          }}
        >
          {selected.truncated && <p role="status">{t('quoteBatchTruncated')}</p>}
          <Button
            size="sm"
            onClick={async () => {
              try {
                const copied = await writeClipboard(selected.text)
                if (!tabSignal.aborted) setNotice(copied ? 'copied' : 'copyFailed')
              } catch {
                if (!tabSignal.aborted) setNotice('copyFailed')
              }
            }}
          >
            {t('copy')}
          </Button>
          {quote && (
            <Button size="sm" onClick={() => quote(selected)}>
              {t('quote')}
            </Button>
          )}
          <Button
            size="sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const region =
                body.current && selectedRange.current && !selected.truncated
                  ? excerptRegion(body.current, selectedRange.current)
                  : undefined
              setCapturing({ selection: selected, region })
            }}
          >
            {t('documentCapture')}
          </Button>
          {(translate || browserTranslationProvider()) && (
            <Button size="sm" onClick={() => setTranslating(selected)}>
              {t('translation')}
            </Button>
          )}
        </div>
      )}
      {capturing && (
        <ReaderExcerptCapture
          t={t}
          title={title}
          text={
            capturing.selection.truncated
              ? `${capturing.selection.text}\n\n${t('quoteBatchTruncated')}`
              : capturing.selection.text
          }
          region={capturing.region}
          tabSignal={tabSignal}
          onQuote={quote && (() => quote(capturing.selection, undefined, true))}
          onClose={() => setCapturing(undefined)}
        />
      )}
      {translating && (
        <ReaderTranslation
          t={t}
          text={translating.text}
          tabSignal={tabSignal}
          cache={cache.current}
          modelTranslation={translate}
          onQuote={quote && ((result) => quote(translating, result))}
          onClose={() => setTranslating(undefined)}
        />
      )}
      {notice && <p role="status">{t(notice)}</p>}
    </>
  )
}
