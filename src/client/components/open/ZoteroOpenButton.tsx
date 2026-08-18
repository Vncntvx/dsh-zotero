/**
 * One open-in-Zotero deep link as an action-area button, for the open and
 * unverified verdicts. The anchor keeps the row's bordered-button geometry
 * (callers pass the row's own class when they need the exact cadence); an
 * unverified target carries its caveat in the native title so the row never
 * grows an inline note that would break the button alignment. Blocked
 * targets never render here — `BlockedOpenAction` is the blocked form.
 * @module dsh-zotero/client/components/open/ZoteroOpenButton
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenVerdict } from '../../actions/open-zotero.ts'
import css from './open.module.css'

export interface ZoteroOpenButtonProps {
  readonly url: string
  /** Must not be `blocked`; blocked targets render `BlockedOpenAction`. */
  readonly verdict: OpenVerdict
  readonly label: string
  readonly t: TranslateNS<'zotero'>
  /** The anchor's class; defaults to the shared action button. */
  readonly className?: string
}

/** One provenance-guarded action button. */
export function ZoteroOpenButton({ url, verdict, label, t, className }: ZoteroOpenButtonProps) {
  return (
    <a
      className={className ?? css.button}
      href={url}
      target="_blank"
      rel="noreferrer"
      title={verdict === 'unverified' ? t('instanceUnverified') : undefined}
    >
      {label}
    </a>
  )
}
