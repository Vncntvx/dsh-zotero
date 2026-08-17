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
import { interpolate } from '../presenters.ts'
import type { SourceItem } from '../sources/model.ts'
import { CopyButton } from './SourceRow.tsx'
import css from './SourcesList.module.css'

export interface SourceDetailProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
}

/** The dossier body of one source row. */
export function SourceDetail({ item, t }: SourceDetailProps) {
  const operations = [item.operations.running, item.operations.failed, item.operations.stopped]
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
          <p className={css.line}>{item.attachment.location}</p>
          <CopyButton value={item.attachment.location} label={t('copy')} t={t} />
        </div>
      )}
      {item.attachment === undefined && item.bestAttachment !== undefined && (
        <div className={css.section}>
          <p className={css.sectionLabel}>{t('bestAttachmentLabel')}</p>
          <p className={css.line}>
            {item.bestAttachment.ref ?? item.bestAttachment.contentType ?? ''}
          </p>
          {item.bestAttachment.ref !== undefined && (
            <CopyButton value={item.bestAttachment.ref} label={t('copyRef')} t={t} />
          )}
        </div>
      )}
      {item.facts.evidenceCount > 0 && (
        <p className={css.line}>
          {interpolate(t('evidenceInDetail'), { count: item.facts.evidenceCount })}
        </p>
      )}
      {item.facts.exportCount > 0 && (
        <p className={css.line}>
          {interpolate(t('exportsInDetail'), { count: item.facts.exportCount })}
        </p>
      )}
      {item.provenance === 'mismatch' && <p className={css.warning}>{t('provenanceMismatch')}</p>}
      {operations.some((count) => count > 0) && (
        <p className={css.line}>
          {[
            item.operations.running > 0
              ? interpolate(t('runningBadge'), { count: item.operations.running })
              : '',
            item.operations.failed > 0
              ? interpolate(t('failedBadge'), { count: item.operations.failed })
              : '',
            item.operations.stopped > 0
              ? interpolate(t('stoppedBadge'), { count: item.operations.stopped })
              : '',
          ]
            .filter((part) => part !== '')
            .join(' · ')}
        </p>
      )}
    </div>
  )
}
