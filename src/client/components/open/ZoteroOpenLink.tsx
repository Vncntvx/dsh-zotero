/**
 * One open-in-Zotero deep link as an in-body text link, for the open and
 * unverified verdicts: the anchor hands the `zotero://` URL to the OS
 * protocol handler, and an unverified target keeps its caveat beside the
 * link. Blocked targets never render here — `BlockedOpenAction` is the
 * blocked form, so a warning span can never break a button row.
 * @module dsh-zotero/client/components/open/ZoteroOpenLink
 */

import { IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenVerdict } from '../../actions/open-zotero.ts'
import { externalHrefProps } from './external-href.ts'
import css from './open.module.css'

export interface ZoteroOpenLinkProps {
  readonly url: string
  /** Must not be `blocked`; blocked targets render `BlockedOpenAction`. */
  readonly verdict: OpenVerdict
  readonly label: string
  readonly t: TranslateNS<'zotero'>
  /** The anchor's class; defaults to the shared text link. */
  readonly className?: string
  /** Optional click handler (e.g. stopPropagation). */
  readonly onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  /**
   * Stop event propagation to parent disclosures. Defaults to true to avoid
   * accidentally toggling collapsible cards when opening links.
   */
  readonly stopPropagation?: boolean
}

/** One provenance-guarded text link: leading category glyph per the harness
 * clickable-link spec (`renderSafeLink` always leads with `<IconLinkOutlineMedium>`
 * for destination links; `zotero://` is a destination, not a file path, so it
 * never goes through `classifyLinkPath`). External `http(s)` targets open in a
 * new tab with the safe rel; protocol links hand to the OS handler in place
 * with no blank tab. */
export function ZoteroOpenLink({
  url,
  verdict,
  label,
  t,
  className,
  onClick,
  stopPropagation = true,
}: ZoteroOpenLinkProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (stopPropagation) {
      e.stopPropagation()
    }
    onClick?.(e)
  }

  return (
    <span className={css.linkWrap}>
      <a
        className={className ?? css.link}
        href={url}
        {...externalHrefProps(url)}
        onClick={handleClick}
      >
        <IconLinkOutlineMedium className={css.linkIcon} />
        {label}
      </a>
      {verdict === 'unverified' && (
        <span className={css.note}>
          {t('openUnverifiedNote', { detail: t('instanceUnverified') })}
        </span>
      )}
    </span>
  )
}
