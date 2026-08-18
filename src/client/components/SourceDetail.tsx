/**
 * One source's dossier: everything the session proved about the item —
 * search provenance, the resolved attachment location, Zotero's attachment
 * selection when nothing was resolved, evidence and export counts (the full
 * passages and artifacts live on their own lenses), the mismatch warning,
 * and the non-successful operation counts. Facts only; nothing here implies
 * reading, citing, or any stage beyond what the calls actually did.
 * @module dsh-zotero/client/components/SourceDetail
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate, joinNonEmpty } from '../presenters.ts'
import type { SourceItem } from '../sources/model.ts'
import { CopyButton } from './CopyButton.tsx'
import { operationsLabelsOf } from './operations.ts'
import css from './SourcesList.module.css'

export interface SourceDetailProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** Whether a web URL is safe to open directly (http/https only). */
export function isSafeWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** The dossier body of one source row. */
export function SourceDetail({ item, t }: SourceDetailProps) {
  const operationLabels = operationsLabelsOf(item.operations, t)
  return (
    <div className={css.dossier}>
      {item.searches.length > 0 && (
        <div className={css.section}>
          <p className={css.sectionLabel}>{t('fromSearches')}</p>
          <ul className={css.lines}>
            {item.searches.map((search, index) => (
              <li key={`${search.callId}-${index}`} className={css.line}>
                {search.query !== undefined
                  ? interpolate(t('searchFrom'), { query: search.query })
                  : t('searchFromBrowse')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.attachment !== undefined && (
        <div className={css.section}>
          <p className={css.sectionLabel}>
            {t(item.attachment.kind === 'file' ? 'localFile' : 'linkedUrl')}
          </p>
          {item.attachment.kind === 'url' && isSafeWebUrl(item.attachment.location) ? (
            <a
              className={css.link}
              href={item.attachment.location}
              target="_blank"
              rel="noreferrer"
            >
              {item.attachment.location}
            </a>
          ) : (
            <p className={css.line}>{item.attachment.location}</p>
          )}
          <CopyButton
            value={item.attachment.location}
            label={t('copy')}
            copiedLabel={t('copied')}
          />
        </div>
      )}
      {item.attachment === undefined && item.bestAttachment !== undefined && (
        <div className={css.section}>
          <p className={css.sectionLabel}>{t('bestAttachmentLabel')}</p>
          <p className={css.line}>
            {item.bestAttachment.ref ?? item.bestAttachment.contentType ?? ''}
          </p>
          {item.bestAttachment.ref !== undefined && (
            <CopyButton
              value={item.bestAttachment.ref}
              label={t('copyRef')}
              copiedLabel={t('copied')}
            />
          )}
        </div>
      )}
      {item.facts.evidenceCount > 0 && (
        <p className={css.line}>
          {interpolate(t('evidenceInDetail'), { count: item.facts.evidenceCount })}
        </p>
      )}
      {item.facts.reportedEvidenceCount > item.facts.evidenceCount && (
        <p className={css.line}>
          {interpolate(t('reportedEvidenceInDetail'), { count: item.facts.reportedEvidenceCount })}
        </p>
      )}
      {item.facts.exportCount > 0 && (
        <p className={css.line}>
          {interpolate(t('exportsInDetail'), { count: item.facts.exportCount })}
        </p>
      )}
      {item.provenance === 'mismatch' && <p className={css.warning}>{t('provenanceMismatch')}</p>}
      {operationLabels.length > 0 && <p className={css.line}>{joinNonEmpty(...operationLabels)}</p>}
    </div>
  )
}
