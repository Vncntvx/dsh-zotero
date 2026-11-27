import { useRef, useState } from 'react'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TextRange } from '../../../reader/evidence.ts'
import { ReaderExcerptCapture } from '../../reader/ReaderExcerptCapture.tsx'
import { ReaderTranslation, type ReaderTranslationResult } from '../../reader/ReaderTranslation.tsx'
import type { ReaderTabFace } from '../../reader/ReaderTab.tsx'
import { excerptPrefix } from '../../reader/pdf-excerpt.ts'
import { MAX_PARSED_CITATION_PREFIX } from '../../parsed-tab.ts'
import { readerEn, readerZh } from '../../reader/locales.ts'

export interface ParsedExcerpt {
  readonly kind: 'capture' | 'translate'
  readonly signal: AbortSignal
  readonly artifactId: string
  readonly text: string
  readonly textRange: TextRange
  readonly truncated: boolean
  readonly region?: Parameters<typeof ReaderExcerptCapture>[0]['region']
}

interface Props {
  readonly excerpt: ParsedExcerpt
  readonly title: string
  readonly sessionId: SessionId
  readonly fingerprint: string
  readonly attachmentRef?: string
  readonly language: string
  readonly inputActions?: InputActions
  readonly translate?: ReaderTabFace['translate']
  readonly onClose: () => void
}

export function ParsedDocumentExcerpt({
  excerpt,
  title,
  sessionId,
  fingerprint,
  attachmentRef,
  language,
  inputActions,
  translate,
  onClose,
}: Props) {
  const [notice, setNotice] = useState<'quoteBatchAdded' | 'quoteInsertFailed'>()
  const cache = useRef(new Map<string, string>())
  const dictionary = /^zh(?:-|$)/iu.test(language) ? readerZh : readerEn
  const t: TranslateNS<'zoteroReader'> = (key, params) =>
    (
      dictionary[key as keyof typeof readerEn] ??
      readerEn[key as keyof typeof readerEn] ??
      key
    ).replace(/\{(\w+)\}/gu, (whole, name: string) => String(params?.[name] ?? whole))
  const text = excerpt.truncated ? `${excerpt.text}\n\n${t('quoteBatchTruncated')}` : excerpt.text
  const quote = (result?: ReaderTranslationResult) => {
    if (!inputActions || excerpt.signal.aborted) return false
    const body = result ? `${text}\n\n${t('translationResult')}\n${result.text}` : text
    const source = {
      sourceType: result ? 'translation' : 'screenshot',
      kind: 'artifactId',
      artifactId: excerpt.artifactId,
      attachmentRef,
      fingerprint,
      title: title.slice(0, 500),
      documentType: 'parsed',
      textRange: excerpt.textRange,
      textPrefix: excerptPrefix(excerpt.text, MAX_PARSED_CITATION_PREFIX),
      truncated: excerpt.truncated,
      translation: result && { target: result.target, engine: result.engine },
    }
    const inserted = inputActions.insertQuote(`${body}\n\n${JSON.stringify(source)}`, {
      label: t(result ? 'translation' : 'capture'),
      title,
      body,
    })
    if (inserted) inputActions.persistDraft()
    setNotice(inserted ? 'quoteBatchAdded' : 'quoteInsertFailed')
    return inserted
  }
  return (
    <>
      {excerpt.kind === 'capture' ? (
        <ReaderExcerptCapture
          t={t}
          title={title}
          text={text}
          region={excerpt.region}
          tabSignal={excerpt.signal}
          onQuote={inputActions && (() => quote())}
          onClose={onClose}
        />
      ) : (
        <ReaderTranslation
          t={t}
          text={excerpt.text}
          tabSignal={excerpt.signal}
          cache={cache.current}
          modelTranslation={
            translate && ((text, target, signal) => translate({ sessionId, text, target }, signal))
          }
          onQuote={inputActions && quote}
          onClose={onClose}
        />
      )}
      {notice && <p role="status">{t(notice)}</p>}
    </>
  )
}
