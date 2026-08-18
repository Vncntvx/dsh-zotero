/**
 * One source row: the title line with a metadata summary, provable fact
 * badges (never a funnel), line-end actions (copy ref, ask-about prefill),
 * and an expandable dossier. The header is a whole-line toggle like the
 * harness's tool rows; actions sit outside the toggle so a copy or prefill
 * never opens the row.
 * @module dsh-zotero/client/components/SourceRow
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { askDraftOf, exportDraftOf } from '../actions/source-actions.ts'
import { interpolate, joinNonEmpty } from '../presenters.ts'
import type { SourceItem } from '../sources/model.ts'
import { CopyButton } from './CopyButton.tsx'
import { operationsLabelsOf } from './operations.ts'
import { SourceDetail } from './SourceDetail.tsx'
import css from './SourcesList.module.css'

/** The provable fact badges of one source, in fixed order. */
export function badgesOf(item: SourceItem, t: TranslateNS<'zotero'>): string[] {
  const badges: string[] = []
  if (item.provenance === 'mismatch') badges.push(t('provenanceMismatch'))
  if (item.facts.attachmentResolved) {
    badges.push(
      item.attachment?.contentType === 'application/pdf' ? t('badgePdf') : t('attachmentBadge'),
    )
  } else if (item.bestAttachment?.contentType === 'application/pdf') {
    badges.push(t('badgePdf'))
  }
  if (item.facts.evidenceCount > 0)
    badges.push(interpolate(t('evidenceBadge'), { count: item.facts.evidenceCount }))
  if (item.facts.exportCount > 0)
    badges.push(interpolate(t('exportBadge'), { count: item.facts.exportCount }))
  badges.push(...operationsLabelsOf(item.operations, t))
  return badges
}

/**
 * Whether the dossier has anything to show beyond the header line. Must
 * mirror the sections `SourceDetail` renders, or rows lose their expand
 * affordance when a new section appears.
 */
export function hasDossierContent(item: SourceItem): boolean {
  return (
    item.searches.length > 0 ||
    item.attachment !== undefined ||
    item.bestAttachment !== undefined ||
    item.facts.evidenceCount > 0 ||
    item.facts.exportCount > 0 ||
    item.operations.failed > 0 ||
    item.operations.running > 0 ||
    item.operations.stopped > 0 ||
    item.provenance === 'mismatch'
  )
}

export interface SourceRowProps {
  readonly item: SourceItem
  readonly t: TranslateNS<'zotero'>
  readonly setDraft?: (text: string) => void
}

/** One expandable source row. */
export function SourceRow({ item, t, setDraft }: SourceRowProps) {
  const [open, setOpen] = useState(false)
  const expandable = hasDossierContent(item)
  const badges = badgesOf(item, t)
  return (
    <div className={css.row} data-provenance={item.provenance}>
      <button
        type="button"
        className={css.rowHead}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => {
          // The disabled attribute keeps real clicks out; the head stays a
          // plain open/close toggle.
          setOpen(!open)
        }}
      >
        <span className={css.rowTitle}>{item.title ?? item.ref}</span>
        <span className={css.rowMeta}>{joinNonEmpty(item.creators, item.year, item.venue)}</span>
        {badges.length > 0 && (
          <span className={css.badges}>
            {badges.map((badge) => (
              <span key={badge} className={css.badge} data-badge>
                {badge}
              </span>
            ))}
          </span>
        )}
        {expandable && (
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        )}
      </button>
      <span className={css.lineActions}>
        <CopyButton value={item.ref} label={t('copyRef')} t={t} />
        {setDraft !== undefined && (
          <button
            type="button"
            className={css.lineAction}
            onClick={() => {
              setDraft(askDraftOf(item.ref, t))
            }}
          >
            {t('askAboutItem')}
          </button>
        )}
        {setDraft !== undefined && (
          <button
            type="button"
            className={css.lineAction}
            onClick={() => {
              setDraft(exportDraftOf(item.ref, t))
            }}
          >
            {t('exportCitation')}
          </button>
        )}
      </span>
      {expandable && open && <SourceDetail item={item} t={t} />}
    </div>
  )
}
