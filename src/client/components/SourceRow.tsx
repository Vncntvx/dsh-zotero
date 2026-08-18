/**
 * One source row: the title line with a metadata summary, the provable fact
 * badges (a strict whitelist — PDF, evidence, exports, issues), line-end
 * actions (the provenance-guarded open buttons, copy ref, ask-about and
 * export prefills), and an expandable dossier. The header is a whole-line
 * toggle like the harness's tool rows; actions sit outside the toggle so a
 * copy or prefill never opens the row.
 * @module dsh-zotero/client/components/SourceRow
 */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { askDraftOf, exportDraftOf } from '../actions/source-actions.ts'
import { openVerdictOf, selectUrlOf } from '../actions/open-zotero.ts'
import { interpolate, joinNonEmpty } from '../presenters.ts'
import type { SourceItem } from '../sources/model.ts'
import { hasIssue } from '../sources/selectors.ts'
import { hasPdf, pdfCapabilityOf } from '../sources/source-capabilities.ts'
import { CopyButton } from './CopyButton.tsx'
import { BlockedOpenAction } from './open/BlockedOpenAction.tsx'
import { ZoteroOpenButton } from './open/ZoteroOpenButton.tsx'
import { SourceDetail } from './SourceDetail.tsx'
import css from './SourcesList.module.css'

/**
 * The provable fact badges of one source: a strict whitelist of PDF,
 * evidence count, export count, and issues. The PDF badge shares its single
 * source of truth with the "with PDF" filter and the open-PDF button
 * (`hasPdf`); reported counts, truncation, and operation detail stay in the
 * dossier and the lenses.
 */
export function badgesOf(item: SourceItem, t: TranslateNS<'zotero'>): string[] {
  const badges: string[] = []
  if (hasPdf(item)) badges.push(t('badgePdf'))
  if (item.facts.evidenceCount > 0)
    badges.push(interpolate(t('evidenceBadge'), { count: item.facts.evidenceCount }))
  if (item.facts.exportCount > 0)
    badges.push(interpolate(t('exportBadge'), { count: item.facts.exportCount }))
  if (hasIssue(item)) badges.push(t('issuesBadge'))
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
    item.facts.reportedEvidenceCount > item.facts.evidenceCount ||
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
  const verdict = openVerdictOf(item)
  const selectUrl = selectUrlOf(item.ref)
  const pdfCapability = pdfCapabilityOf(item)
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
        {selectUrl !== null &&
          (verdict === 'blocked' ? (
            <BlockedOpenAction label={t('openInZotero')} t={t} className={css.lineAction} />
          ) : (
            <ZoteroOpenButton
              url={selectUrl}
              verdict={verdict}
              label={t('openInZotero')}
              t={t}
              className={css.lineAction}
            />
          ))}
        {pdfCapability !== null &&
          (verdict === 'blocked' ? (
            <BlockedOpenAction label={t('openPdf')} t={t} className={css.lineAction} />
          ) : (
            <ZoteroOpenButton
              url={pdfCapability.url}
              verdict={verdict}
              label={t('openPdf')}
              t={t}
              className={css.lineAction}
            />
          ))}
        <CopyButton value={item.ref} label={t('copyRef')} copiedLabel={t('copied')} />
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
