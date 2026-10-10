/**
 * Shared tool-call block factories for the client specs: a settled
 * `zotero_search` result and an in-flight call, both with neutral defaults.
 * Specs that need a specialized default (a result carrying presentation meta,
 * a running get on a known ref) wrap these with their own default overrides.
 *
 * The harness requires `name` and the lazy `args` view on every block
 * (`packages/client/ui-conversation/src/client/contract/records.ts`:
 * `ToolCallHead.args`, `ToolResultNode.name`/`args`). These factories derive
 * both **after** the overrides merge, from whatever `argsRaw`/`call` the spec
 * ends up with, so a spec that overrides `call` or `argsRaw` cannot leave the
 * view describing the default payload instead. The harness's own builders keep
 * the same relationship (`ui-chat/src/client/conversation-nodes/tool.ts`:
 * `rootCall`, `rootResult`). Pass `args` explicitly to pin a view on purpose.
 * @module tests/client/helpers/blocks
 */

import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type {
  PreparingToolCall,
  StartedToolCall,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** A named model call still preparing (no arguments landed yet); override `name`/`args`. */
export function preparing(overrides: Partial<PreparingToolCall> = {}): PreparingToolCall {
  return {
    phase: 'preparing',
    callId: 'c1',
    name: 'zotero_search',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: [],
    ...overrides,
    args: overrides.args ?? PartialArguments.EMPTY,
  }
}

/**
 * A settled `zotero_search` result; override `call` to name other tools.
 * `name` and `args` follow that call, and a `call: null` (a window cut before
 * the call landed) leaves both empty: exactly the harness's `rootResult`.
 */
export function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  const call = Object.hasOwn(overrides, 'call')
    ? (overrides.call ?? null)
    : { name: 'zotero_search', argsRaw: '{}' }
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2,
    callId: 'c1',
    callTime: 1,
    content: [],
    isError: false,
    subCalls: [],
    ...overrides,
    call,
    name: overrides.name ?? call?.name ?? '',
    args:
      overrides.args ??
      (call === null ? PartialArguments.EMPTY : PartialArguments.fromText(call.argsRaw)),
  }
}

/** A dispatched `zotero_search` call; override `name`/`argsRaw` for other tools. */
export function running(overrides: Partial<StartedToolCall> = {}): StartedToolCall {
  const argsRaw = overrides.argsRaw ?? '{}'
  return {
    phase: 'start',
    callId: 'c1',
    name: 'zotero_search',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: [],
    ...overrides,
    argsRaw,
    args: overrides.args ?? PartialArguments.fromText(argsRaw),
  }
}
