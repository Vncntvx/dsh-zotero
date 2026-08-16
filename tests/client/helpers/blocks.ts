/**
 * Shared tool-call block factories for the client specs: a settled
 * `zotero_search` result and an in-flight call, both with neutral defaults.
 * Specs that need a specialized default (a pending row carrying a call view,
 * a running get on a known ref) wrap these with their own default overrides.
 * @module tests/client/helpers/blocks
 */

import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'

/** A settled `zotero_search` result; override `call` to name other tools. */
export function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 2,
    time: 2,
    callId: 'c1',
    call: { name: 'zotero_search', argsRaw: '{}' },
    callTime: 1,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...overrides,
  }
}

/** An in-flight `zotero_search` call; override `name`/`argsRaw` for other tools. */
export function running(overrides: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'c1',
    name: 'zotero_search',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 1,
    callView: null,
    subCalls: [],
    ...overrides,
  }
}
