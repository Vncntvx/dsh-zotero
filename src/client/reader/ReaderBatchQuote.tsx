import { useState } from 'react'
import { Button, Checkbox, formatQuoteText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroAnnotationRowView, ZoteroNoteRowView } from '../../contract.ts'
import type { PdfQuoteSource } from '../../reader/evidence.ts'
import { excerptPrefix, MAX_EXCERPT_TEXT } from './pdf-excerpt.ts'
import css from './reader.module.css'

const MAX_BATCH = 8
const MAX_ENTRY = 1_500

type BatchSource =
  | {
      readonly kind: 'annotation'
      readonly source: PdfQuoteSource
      readonly pageCount: number
      readonly entries: readonly ZoteroAnnotationRowView[]
    }
  | {
      readonly kind: 'note'
      readonly itemRef: string
      readonly title: string
      readonly entries: readonly ZoteroNoteRowView[]
    }

type Props = PropsLocale<'zoteroReader'> &
  BatchSource & {
    readonly tabSignal: AbortSignal
    readonly inputActions: Pick<InputActions, 'insertQuote' | 'persistDraft'>
  }

export function ReaderBatchQuote(props: Props) {
  const { t, kind, tabSignal, inputActions } = props
  const [selected, setSelected] = useState<readonly string[]>([])
  const [notice, setNotice] = useState<'quoteBatchAdded' | 'quoteInsertFailed'>()
  const label = t(kind === 'annotation' ? 'quoteAnnotationBatch' : 'quoteNoteBatch')
  const choices = props.entries.flatMap((entry) => {
    const comment = 'comment' in entry && entry.comment
    const raw = [entry.text, comment && t('quoteAnnotationComment', { comment })]
      .filter(Boolean)
      .join('\n\n')
      .trim()
    if (!raw) return []
    const text = excerptPrefix(raw, MAX_ENTRY)
    const excerptTruncated = ('truncated' in entry && entry.truncated) || raw.length > text.length
    return [
      {
        entry,
        text,
        heading: t(kind === 'annotation' ? 'quoteAnnotationSource' : 'noteSource', {
          ref: entry.ref,
        }),
        excerptTruncated,
      },
    ]
  })
  const picked = choices.filter(({ entry }) => selected.includes(entry.ref))
  const body = picked
    .map(({ heading, text, excerptTruncated }) =>
      [heading, text, excerptTruncated && t('quoteBatchTruncated')].filter(Boolean).join('\n'),
    )
    .join('\n\n')
  const sources = picked.map(({ entry, text, excerptTruncated }) => {
    const pageIndex = 'position' in entry ? entry.position?.pageIndex : undefined
    const pages =
      kind === 'annotation' &&
      pageIndex !== undefined &&
      pageIndex >= 0 &&
      pageIndex < props.pageCount
        ? [{ pageIndex }]
        : []
    const provenance =
      kind === 'annotation'
        ? {
            ...props.source,
            sourceType: kind,
            precision: pages.length ? 'page' : 'document',
            annotationRef: entry.ref,
            annotationPageLabel: 'pageLabel' in entry ? entry.pageLabel : undefined,
            pages,
          }
        : {
            noteRef: entry.ref,
            sourceType: kind,
            itemRef: props.itemRef,
            title: excerptPrefix(text, 80),
          }
    return { ...provenance, ...(excerptTruncated && { excerptTruncated }) }
  })
  const draft = picked.length ? [body, JSON.stringify(sources)].join('\n\n') : ''
  const formattedLength = formatQuoteText(draft).length
  const tooLong = formattedLength > MAX_EXCERPT_TEXT
  const insert = () => {
    if (!picked.length || tooLong || tabSignal.aborted) return
    const title = kind === 'annotation' ? props.source.title : props.title
    if (!inputActions.insertQuote(draft, { title, label, body })) {
      setNotice('quoteInsertFailed')
      return
    }
    inputActions.persistDraft()
    setSelected([])
    setNotice('quoteBatchAdded')
  }

  if (!choices.length) return null
  return (
    <details className={css.disclosure}>
      <summary>{label}</summary>
      <fieldset className={css.fieldset}>
        <legend>{t('quoteBatchLimit', { count: MAX_BATCH })}</legend>
        <ul className={css.annotationList}>
          {choices.map(({ entry: { ref }, text }) => {
            const checked = selected.includes(ref)
            return (
              <li key={ref}>
                <Checkbox
                  checked={checked}
                  disabled={!checked && picked.length >= MAX_BATCH}
                  label={text.length > 150 ? `${excerptPrefix(text, 150)}…` : text}
                  onChange={() => {
                    setNotice(undefined)
                    const refs = picked.map(({ entry }) => entry.ref)
                    setSelected(checked ? refs.filter((key) => key !== ref) : [...refs, ref])
                  }}
                />
              </li>
            )
          })}
        </ul>
      </fieldset>
      {!!picked.length && (
        <>
          <p className={css.quoteText}>{body}</p>
          <p role="status">
            {t('quoteEstimatedTokens', { count: 4 + Math.ceil(formattedLength / 4) })}
          </p>
        </>
      )}
      {tooLong && <p role="status">{t('quoteBatchTooLong')}</p>}
      <Button size="sm" variant="primary" disabled={!picked.length || tooLong} onClick={insert}>
        {t('quoteAddDraft')}
      </Button>
      {notice && <p role="status">{t(notice)}</p>}
    </details>
  )
}
