/**
 * One source list item: a listbox option with no actions, only identification
 * (title, metadata summary, strict badge whitelist, topic chips) and selection.
 * The row is the option, so the whole surface is the activation target;
 * the keyboard contract lives on the listbox (roving tabindex, arrows).
 * The selected visual is a light background plus a 2px primary line on the
 * left edge. Badges share the row's single source of truth (`badgesOf`).
 * @module dsh-zotero/client/components/workspace/SourceListItem
 */

import { memo, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { joinNonEmpty } from '../../../sources/presenters.js'
import type { SourceItem } from '../../../sources/model.js'
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
  if (item.evidence.length > 0) badges.push(t('evidenceBadge', { count: item.evidence.length }))
  if (item.exports.length > 0) badges.push(t('exportBadge', { count: item.exports.length }))
  if (hasIssue(item)) badges.push(t('issuesBadge'))
  return badges
}

interface SourceListItemProps {
  readonly item: SourceItem
  readonly index: number
  readonly selected: boolean
  readonly focused: boolean
  readonly setOptionRef?: (index: number, el: HTMLDivElement | null) => void
  readonly onSelect: (key: string, index: number) => void
  readonly t: TranslateNS<'zotero'>
}

/** One source row as a listbox option with rich metadata and badges. */
function SourceListItemComponent({
  item,
  index,
  selected,
  focused,
  setOptionRef,
  onSelect,
  t,
}: SourceListItemProps) {
  const badges = badgesOf(item, t)

  const topicTags = useMemo(() => {
    const tags = new Set<string>()
    for (const s of item.searches) {
      for (const tag of s.tags) {
        if (tag.trim() !== '') tags.add(tag)
      }
    }
    return Array.from(tags).slice(0, 3)
  }, [item.searches])

  const handleSelect = useCallback(() => {
    onSelect(item.key, index)
  }, [onSelect, item.key, index])

  const refCallback = useCallback(
    (el: HTMLDivElement | null) => {
      setOptionRef?.(index, el)
    },
    [setOptionRef, index],
  )

  return (
    <div
      ref={refCallback}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      data-evidence-match={item.evidenceMatch}
      className={clsx(css.listItem, selected && css.listItemSelected)}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleSelect()
        }
      }}
    >
      <span className={css.listItemTitle}>{item.title ?? item.ref}</span>
      <span className={css.listItemMeta}>{joinNonEmpty(item.creators, item.year, item.venue)}</span>
      {(badges.length > 0 || topicTags.length > 0) && (
        <span className={css.badges}>
          {badges.map((badge) => (
            <Tag key={badge} tone="neutral">
              {badge}
            </Tag>
          ))}
          {topicTags.map((tag) => (
            <span key={tag} className={css.topicTag}>
              #{tag}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}

export const SourceListItem = memo(SourceListItemComponent)
