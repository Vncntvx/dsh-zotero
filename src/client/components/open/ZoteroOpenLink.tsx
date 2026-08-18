/**
 * One open-in-Zotero deep link as an in-body text link, for the open and
 * unverified verdicts: the anchor hands the `zotero://` URL to the OS
 * protocol handler, and an unverified target keeps its caveat beside the
 * link. Blocked targets never render here — `BlockedOpenAction` is the
 * blocked form, so a warning span can never break a button row.
 * @module dsh-zotero/client/components/open/ZoteroOpenLink
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenVerdict } from '../../actions/open-zotero.ts'
import { interpolate } from '../../presenters.ts'
import css from './open.module.css'

export interface ZoteroOpenLinkProps {
  readonly url: string
  /** Must not be `blocked`; blocked targets render `BlockedOpenAction`. */
  readonly verdict: OpenVerdict
  readonly label: string
  readonly t: TranslateNS<'zotero'>
  /** The anchor's class; defaults to the shared text link. */
  readonly className?: string
}

/** One provenance-guarded text link. */
export function ZoteroOpenLink({ url, verdict, label, t, className }: ZoteroOpenLinkProps) {
  return (
    <span className={css.linkWrap}>
      <a className={className ?? css.link} href={url} target="_blank" rel="noreferrer">
        {label}
      </a>
      {verdict === 'unverified' && (
        <span className={css.note}>
          {interpolate(t('openUnverifiedNote'), { detail: t('instanceUnverified') })}
        </span>
      )}
    </span>
  )
}
