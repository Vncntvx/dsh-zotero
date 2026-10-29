/**
 * Copy actions for locating a Zotero item: the title, to paste into Zotero
 * Quick Search (Cmd/Ctrl+F), and the canonical `zotero://select` deep link,
 * to paste into notes or an address bar.
 * @module dsh-zotero/client/components/open/ZoteroLocateActions
 */

import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { launchZoteroProtocol, selectUrlOf } from '../../actions/open-zotero.ts'
import { CopyButton } from '../CopyButton.tsx'
import css from './open.module.css'

interface ZoteroLocateActionsProps {
  readonly title?: string | null
  readonly itemRef?: string
  readonly selectUrl?: string | null
  readonly t: TranslateNS<'zotero'>
  readonly className?: string
  readonly variant?: 'button' | 'link'
}

export function ZoteroLocateActions({
  title,
  itemRef,
  selectUrl,
  t,
  className,
  variant = 'button',
}: ZoteroLocateActionsProps) {
  const canonicalUrl = selectUrl !== undefined ? selectUrl : itemRef ? selectUrlOf(itemRef) : null
  const baseClass = variant === 'link' ? css.link : css.button
  const buttonClass = clsx(baseClass, className)

  const handleOpen = () => {
    if (canonicalUrl) {
      launchZoteroProtocol(canonicalUrl)
    }
  }

  return (
    <>
      {title && (
        <CopyButton
          value={title}
          label={t('copyTitle')}
          copiedLabel={t('copied')}
          title={t('copyTitleTooltip')}
          className={buttonClass}
        />
      )}
      {canonicalUrl && (
        <>
          <button
            type="button"
            className={buttonClass}
            onClick={handleOpen}
            title={t('openInZoteroTooltip')}
            aria-label={t('openInZotero')}
          >
            <IconLinkOutlineRegular size={12} className={css.linkIcon} />
            <span>{t('openInZotero')}</span>
          </button>
          <CopyButton
            value={canonicalUrl}
            label={t('copyZoteroLink')}
            copiedLabel={t('copied')}
            title={t('copyZoteroLinkTooltip')}
            className={buttonClass}
          />
        </>
      )}
    </>
  )
}
