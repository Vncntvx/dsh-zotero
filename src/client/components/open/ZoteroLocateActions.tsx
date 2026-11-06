/**
 * Copy actions for locating a Zotero item: the title, to paste into Zotero
 * Quick Search (Cmd/Ctrl+F), and the canonical `zotero://select` deep link,
 * to paste into notes or an address bar.
 * @module dsh-zotero/client/components/open/ZoteroLocateActions
 */

import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { selectUrlOf } from '../../actions/open-zotero.ts'
import { CopyButton } from '../CopyButton.tsx'
import linkCss from '../link.module.css'

interface ZoteroLocateActionsProps {
  readonly title?: string | null
  readonly itemRef?: string
  readonly selectUrl?: string | null
  readonly t: TranslateNS<'zotero'>
  /** Layout-only class; geometry comes from the host Button or link.module.css. */
  readonly className?: string
  readonly variant?: 'button' | 'link'
  /** The shared client face's Host-backed launcher; absent only in bare tests. */
  readonly openProtocol?: (url: string) => Promise<boolean>
}

export function ZoteroLocateActions({
  title,
  itemRef,
  selectUrl,
  t,
  className,
  variant = 'button',
  openProtocol,
}: ZoteroLocateActionsProps) {
  const canonicalUrl = selectUrl !== undefined ? selectUrl : itemRef ? selectUrlOf(itemRef) : null
  const isLink = variant === 'link'
  const copyVariant = isLink ? 'link' : 'outline'

  const handleOpen = () => {
    if (canonicalUrl && openProtocol !== undefined) {
      void openProtocol(canonicalUrl)
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
          variant={copyVariant}
          className={className}
        />
      )}
      {canonicalUrl && (
        <>
          {isLink ? (
            <button
              type="button"
              className={clsx(linkCss.link, className)}
              onClick={handleOpen}
              disabled={openProtocol === undefined}
              title={t('openInZoteroTooltip')}
              aria-label={t('openInZotero')}
            >
              <IconLinkOutlineRegular size={12} className={linkCss.linkIcon} />
              <span>{t('openInZotero')}</span>
            </button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className={className}
              icon={<IconLinkOutlineRegular size={12} />}
              onClick={handleOpen}
              disabled={openProtocol === undefined}
              title={t('openInZoteroTooltip')}
              aria-label={t('openInZotero')}
            >
              {t('openInZotero')}
            </Button>
          )}
          <CopyButton
            value={canonicalUrl}
            label={t('copyZoteroLink')}
            copiedLabel={t('copied')}
            title={t('copyZoteroLinkTooltip')}
            variant={copyVariant}
            className={className}
          />
        </>
      )}
    </>
  )
}
