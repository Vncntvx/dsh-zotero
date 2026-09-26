/**
 * `/zotero` command-input projection: the conversation node that leaves the
 * blank Hero. Ordinary command-only history stays Hero-ward (the shell's
 * `isActive` treats `command` rows as non-activity); a non-command node is
 * the designed activation edge — `/goal`'s `command-input` is the shipped
 * example. This Definition mirrors that pattern for `/zotero`, so a status
 * run on a fresh session becomes visible instead of logging behind the Hero.
 * The generic command Definition still owns the result row.
 * @module dsh-zotero/client/zotero-command-input
 */

import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-commands/types'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** The command name whose runs this projection owns. */
export const ZOTERO_COMMAND = 'zotero'

/** Human-entered `/zotero` command input projected independently of model messages. */
export interface ZoteroCommandInputData {
  readonly commandId: CommandId
  readonly text: string
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Human-entered `/zotero` command input. */
    'zotero-command-input': ZoteroCommandInputData
  }
}

interface ZoteroCommandInputState extends ZoteroCommandInputData {
  readonly seq: number
}

/**
 * Format a command name and optional arguments into a normalized slash command string.
 * When `name` is null or undefined, defaults to {@link ZOTERO_COMMAND} (`zotero`).
 * When `args` is provided, normalizes whitespace so leading/trailing spaces do not corrupt formatting.
 * @param name - The command name, falling back to 'zotero' if missing.
 * @param args - Raw or trimmed argument string.
 * @returns Normalized command string, e.g. `/zotero` or `/zotero status`.
 */
export function formatCommandLine(
  name: string | null | undefined,
  args: string | null | undefined,
): string {
  const commandName = name ?? ZOTERO_COMMAND
  const trimmed = (args ?? '').trim()
  return trimmed === '' ? `/${commandName}` : `/${commandName} ${trimmed}`
}

/**
 * Derive the visible command line from its structured durable run.
 *
 * `args` is the harness's raw input after the command name (the slice past
 * `/zotero`, so it usually starts with the separating whitespace). It is
 * present only while `recordInput` is on — the default. Collapse the
 * surrounding whitespace and re-insert a single space so both the production
 * `args: ' status'` shape and a already-trimmed `'status'` render as
 * `/zotero status`, never `/zoterostatus`.
 * @param event - `/zotero` command run.
 * @returns the command line the user typed, normalized for display.
 */
export function zoteroCommandText(event: SessionEvent<'command/run'>): string {
  return formatCommandLine(event.data.name, event.data.args)
}

/**
 * Zotero-owned command-input projection; the generic command Definition
 * retains the result row (status text).
 */
export const zoteroCommandInputDefinition: ConversationNodeDefinition<ZoteroCommandInputState> = {
  kind: 'zotero-command-input',
  target: 'chat',
  match: (event) =>
    event.type === 'command/run' && event.data.name === ZOTERO_COMMAND
      ? { id: String(event.data.commandId), role: 'start' }
      : null,
  start: (_context, match) => {
    if (match.event.type !== 'command/run') {
      throw new Error('zotero-command-input start requires command/run')
    }
    return {
      commandId: match.event.data.commandId,
      seq: match.event.seq,
      time: match.event.time,
      text: zoteroCommandText(match.event),
    }
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'zotero-command-input',
      id: context.id,
      target: 'chat',
      // Sit just before the run's own seq so the typed line reads above the
      // generic command result row that owns that seq, matching ui-goal's
      // command-input projection.
      anchorSeq: context.state.seq - 0.1,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      data: {
        commandId: context.state.commandId,
        text: context.state.text,
        time: context.state.time,
      },
    }
  },
}
