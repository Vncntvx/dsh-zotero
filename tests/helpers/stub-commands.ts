/**
 * Minimal command registry stand-in so the plugin's optional `/zotero`
 * command path can be exercised: the host lane composes it when a spec wants
 * the command registered, and the Loader composition maps it onto
 * `test-stub-commands` so the shipped patch's row-dependent inject resolves.
 * One definition, because two structurally identical copies would have to be
 * kept in step by hand.
 * @module tests/helpers/stub-commands
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  CommandId,
  type CommandDefinition,
  type CommandInvocation,
} from '@deepseek-ai/dsh-commands'

/** The default event sequence number the stub session hands back for an appended event. */
export const STUB_EVENT_SEQ = 7

/** One event the stub session recorded. */
export interface AppendedEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * A command invocation whose agent carries the session face the status handler
 * appends to: `src/command.ts` logs the structured status as its own event and
 * answers with that event's seq (`sourceEventSeq`), so a stub agent without a
 * session cannot exercise the handler at all.
 * @param rawInput - the text the user typed after the command name.
 * @param signal - the caller's cancellation signal.
 * @param eventSeq - optional seq the stub session hands back for an appended event (defaults to STUB_EVENT_SEQ).
 * @returns the invocation plus the events the handler appended, in order.
 */
export function stubCommandInvocation(
  rawInput: string,
  signal: AbortSignal = new AbortController().signal,
  eventSeq: number = STUB_EVENT_SEQ,
): CommandInvocation & { readonly appended: AppendedEvent[] } {
  const appended: AppendedEvent[] = []
  const session = {
    append(type: string, data: unknown) {
      appended.push({ type, data })
      return { type, seq: eventSeq, data }
    },
  }
  return {
    commandId: CommandId('test-command'),
    agent: { session } as never,
    rawInput,
    signal,
    attachments: [],
    appended,
  }
}

/** Minimal command registry stand-in the plugin's command path registers into. */
export class StubCommands extends Service {
  readonly registered: CommandDefinition[] = []

  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  register(definition: CommandDefinition): () => void {
    const registered = this.registered
    // Effect-scoped like the real registry: the registration lives in the
    // scope that called register(), so a disposed injection unwinds it.
    return this.ctx.effect(() => {
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    }, 'StubCommands.register()')
  }
}
