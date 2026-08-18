/**
 * One source list item: a listbox option with no actions — identification
 * (title, metadata summary, the strict badge whitelist) and selection only.
 * The row is the option, so the whole surface is the activation target;
 * the keyboard contract lives on the listbox (roving tabindex, arrows).
 * The selected visual is a light background plus a 2px primary line on the
 * left edge. Badges share the row's single source of truth (`badgesOf`).
 * @module dsh-zotero/client/components/workspace/SourceListItem
 */

import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { interpolate, joinNonEmpty } from '../../presenters.ts'
import type { SourceItem } from '../../sources/model.ts'
import { hasIssue } from '../../sources/selectors.ts'
import { hasPdf } from '../../sources/source-capabilities.ts'
import css from './workspace.module.css'

/**
 * The provable fact badges of one source: a strict whitelist of PDF,
 * evidence count, export count, and issues. The PDF badge shares its single
 * source of truth with the "with PDF" filter and the open-PDF button
 * (`hasPdf`); reported counts, truncation, and operation detail stay in the
 * inspector panels.
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

export interface SourceListItemProps {
  readonly item: SourceItem
  readonly index: number
  readonly selected: boolean
  readonly focused: boolean
  readonly optionRef: (el: HTMLDivElement | null) => void
  readonly onSelect: () => void
  readonly t: TranslateNS<'zotero'>
}

/** One source row as a listbox option. */
export function SourceListItem({
  item,
  index,
  selected,
  focused,
  optionRef,
  onSelect,
  t,
}: SourceListItemProps) {
  const badges = badgesOf(item, t)
  return (
    <div
      ref={optionRef}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-provenance={item.provenance}
      className={clsx(css.listItem, selected && css.listItemSelected)}
      onClick={onSelect}
      onKeyDown={(event) => {
        // Enter confirms the selection on narrow surfaces (the parent moves
        // to the detail pane); the arrows are handled by the listbox.
        if (event.key === 'Enter') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <span className={css.listItemTitle}>{item.title ?? item.ref}</span>
      <span className={css.listItemMeta}>{joinNonEmpty(item.creators, item.year, item.venue)}</span>
      {badges.length > 0 && (
        <span className={css.badges}>
          {badges.map((badge) => (
            <span key={badge} className={css.badge} data-badge>
              {badge}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
