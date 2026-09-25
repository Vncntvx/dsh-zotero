/**
 * Right-aligned `/zotero` input bubble without ordinary message actions.
 * The echoed line decorates its leading `/zotero` token as a command chip —
 * the run this Node projects is the fact that that token was a command — and
 * keeps any argument as plain text. Presenting this non-command node is what
 * activates a fresh Conversation shell so the paired result row is visible.
 * @module dsh-zotero/client/ZoteroCommandInputView
 */

import { projectUserText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ZOTERO_COMMAND, type ZoteroCommandInputData } from './zotero-command-input.ts'
import css from './ZoteroCommandInputView.module.css'

type ZoteroCommandInputViewProps = PropsRuntime<'conversation.chat.node', 'zotero-command-input'> &
  PropsLocale<'zotero'>

/**
 * Render one `/zotero` invocation echo as a user-style bubble.
 *
 * A plain function component on purpose: the client-bundle handoff stubs
 * platform externals at import time, so a module-level `memo(...)` would fail
 * the artifact self-check. The bubble is a tiny pure projection and does not
 * need a memo wrapper.
 * @param props - node payload and the zotero locale seat.
 * @returns the command-input bubble.
 */
export function ZoteroCommandInputView({ node, t }: ZoteroCommandInputViewProps) {
  const data: ZoteroCommandInputData = node.data
  // Only the leading token is the executed command; the rest of the line is
  // the optional subcommand, where a further `/zotero` is prose.
  const split = data.text.search(/\s/u)
  const head = split === -1 ? data.text : data.text.slice(0, split)
  const rest = split === -1 ? '' : data.text.slice(split)
  return (
    <div className={css.row} data-command-input="" role="group" aria-label={t('commandInputAria')}>
      <div className={css.stack}>
        <div className={css.bubble}>
          {projectUserText(head, [], [ZOTERO_COMMAND], 'command')}
          {rest !== '' && projectUserText(rest, [])}
        </div>
      </div>
    </div>
  )
}
