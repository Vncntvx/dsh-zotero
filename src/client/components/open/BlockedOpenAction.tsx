/**
 * The blocked form of an open-in-Zotero action: a button that stays
 * focusable (`aria-disabled`, not native `disabled` — a native disabled
 * button receives no pointer or focus events, so no tooltip could anchor to
 * it), explains the mismatch through a tooltip and a screen-reader
 * description, and never executes. The visible label is the accessible
 * name; the tooltip is never the only explanation.
 * @module dsh-zotero/client/components/open/BlockedOpenAction
 */

import { useId } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './open.module.css'

export interface BlockedOpenActionProps {
  readonly label: string
  readonly t: TranslateNS<'zotero'>
  /** The button's class; defaults to the shared action button. */
  readonly className?: string
}

/** One blocked open action: disabled but focusable, with its reason exposed. */
export function BlockedOpenAction({ label, t, className }: BlockedOpenActionProps) {
  const reason = t('provenanceMismatch')
  const reasonId = useId()
  return (
    <>
      <Tooltip label={reason}>
        <button
          type="button"
          className={clsx(className ?? css.button, css.blocked)}
          aria-disabled="true"
          aria-describedby={reasonId}
          onClick={(event) => {
            // aria-disabled keeps real activation out; the block is the point.
            event.preventDefault()
          }}
        >
          {label}
        </button>
      </Tooltip>
      <span id={reasonId} className={css.srOnly}>
        {reason}
      </span>
    </>
  )
}
