import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ZoteroReaderAnnotationsView } from '../../contract.ts'
import type { PdfPageRegion } from '../../reader/evidence.ts'
import { ZOTERO_CHILD_PAGE_ROWS } from '../../constants.ts'
import type { ReaderTabFace } from './ReaderTab.tsx'
import css from './reader.module.css'

interface SiblingAnnotationsProps extends PropsLocale<'zoteroReader'> {
  sessionId: string
  attachmentRef: string
  tabSignal: AbortSignal
  read: ReaderTabFace['annotations']
  disabled: boolean
  onLocate: (position: PdfPageRegion) => void
}

export function ReaderSiblingAnnotations({
  t,
  sessionId,
  attachmentRef,
  tabSignal,
  read,
  disabled,
  onLocate,
}: SiblingAnnotationsProps) {
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<ZoteroReaderAnnotationsView | 'failed'>()
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, tabSignal])
    if (!signal.aborted)
      void read(
        { sessionId, ref: attachmentRef, offset, limit: ZOTERO_CHILD_PAGE_ROWS },
        signal,
      ).then(
        (page) => {
          if (!signal.aborted) setResult(page)
        },
        () => {
          if (!signal.aborted) setResult('failed')
        },
      )
    return () => controller.abort()
  }, [attachmentRef, offset, read, revision, sessionId, tabSignal])

  if (result === undefined) return <p role="status">{t('annotationLoading')}</p>
  if (result === 'failed')
    return (
      <>
        <p role="alert">{t('annotationFailed')}</p>
        <Button
          size="sm"
          onClick={() => {
            setResult(undefined)
            setRevision((value) => value + 1)
          }}
        >
          {t('retry')}
        </Button>
      </>
    )
  if (!result.items.length) return <p className={css.empty}>{t('annotationEmpty')}</p>
  const nextOffset = result.nextOffset
  return (
    <>
      <ul className={css.annotationList}>
        {result.items.map(({ ref, parentRef, position, text, comment, pageLabel }) => {
          const label = text || comment || pageLabel || (position && String(position.pageIndex + 1))
          return (
            <li key={ref}>
              {position && parentRef === attachmentRef ? (
                <Button size="sm" disabled={disabled} onClick={() => onLocate(position)}>
                  {label}
                </Button>
              ) : (
                <span>
                  {label ? `${label} · ${t('annotationUnlocated')}` : t('annotationUnlocated')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {nextOffset !== undefined && (
        <Button
          size="sm"
          onClick={() => {
            setResult(undefined)
            setOffset(nextOffset)
          }}
        >
          {t('more')}
        </Button>
      )}
    </>
  )
}
