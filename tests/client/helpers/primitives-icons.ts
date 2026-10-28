/**
 * The icon stubs: each one is an inline glyph carrying its icon name, so a
 * spec can assert which icon a surface chose without the real artwork.
 * @module tests/client/helpers/primitives-icons
 */

import { createElement, type ReactElement } from 'react'

/** One icon stub: a span whose `data-icon` names the glyph. */
const icon =
  (name: string) =>
  (props: Record<string, unknown>): ReactElement =>
    createElement('span', { 'data-icon': name, ...props })

/** Every icon the mocked primitives module must expose. */
export const primitivesIcons = {
  IconChevronDownOutlineMedium: icon('chevron-down'),
  IconChevronLeftOutlineMedium: icon('chevron-left'),
  IconChevronRightOutlineMedium: icon('chevron-right'),
  IconBrowseOutlineMedium: icon('browse'),
  IconLinkOutlineMedium: icon('link'),
  IconInspectOutlineRegular: icon('inspect'),
  IconBrowseOutlineRegular: icon('browse-regular'),
  IconRefreshOutlineRegular: icon('refresh-regular'),
  IconSearchOutlineRegular: icon('search-regular'),
  IconSearchOutlineMedium: icon('search-medium'),
  IconPlusOutlineRegular: icon('plus-regular'),
  IconQuestionOutlineRegular: icon('question-regular'),
  IconCopyOutlineRegular: icon('copy-regular'),
  IconDeliverDocRegular: icon('deliver-doc'),
  IconBranchOutlineRegular: icon('branch-regular'),
  IconEditOutlineRegular: icon('edit-regular'),
  IconTrashOutlineRegular: icon('trash-regular'),
  IconChevronDownOutlineRegular: icon('chevron-down-regular'),
  IconChevronsUpDownOutlineMedium: icon('chevrons-up-down'),
  IconCheckOutlineRegular: icon('check-regular'),
}
