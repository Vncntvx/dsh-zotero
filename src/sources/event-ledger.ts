/**
 * The host-side event fold of the literature trail: a compact, JSON-only
 * record of the session's Zotero tool outcomes, replayed through the same
 * workspace builder the browser fallback uses.
 *
 * State holds the settled outcome facts (arguments, result content, meta), not
 * the rendered workspace, because the workspace builder owns the aggregation
 * rules and must not be duplicated. The facts are bounded by the session's own
 * tool output: full texts that exceed the inline budget are already spilled by
 * the tools, so a block carries a locator rather than the full text.
 * @module dsh-zotero/sources/event-ledger
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { asRecord, asString } from '../json.js'
import { buildSourceWorkspace } from './ledger.js'
import type { SourceWorkspace } from './model.js'
import { receiptOf } from './receipt.js'
import type { SettledToolBlock, ToolBlockLike } from './block-types.js'

/** One settled Zotero outcome as pure JSON. */
export interface LedgerBlockFact {
  readonly callId: string
  readonly seq: number
  readonly time: number
  readonly name: string
  readonly argsRaw: string
  readonly callTime: number
  readonly content: readonly JsonValue[]
  readonly isError: boolean
  readonly error?: { readonly name: string; readonly code: string; readonly reason?: string }
  readonly meta?: JsonValue
}

/** One call whose result has not landed yet. */
export interface LedgerPendingCall {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
  readonly seq: number
  readonly time: number
}

/** The fold state: settled facts in transcript order plus unsettled calls. */
export interface SourceLedgerState {
  readonly blocks: readonly LedgerBlockFact[]
  readonly pending: Readonly<Record<string, LedgerPendingCall>>
}

/** The projection state: the fold plus the fork-inherited prefix length. */
export interface SourceLedgerProjectionState {
  readonly inheritedEventCount: number
  readonly ledger: SourceLedgerState
}

/** The empty fold state. */
export function emptyLedgerState(): SourceLedgerState {
  return { blocks: [], pending: {} }
}

/** Whether a tool name is one the literature trail records. */
function isZoteroTool(name: string): boolean {
  return name.startsWith('zotero_')
}

/** Narrow one raw event to the structural fields the fold reads. */
interface LedgerEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
}

function asEvent(event: SessionEvent): LedgerEvent {
  const raw = event as unknown as {
    type: string
    seq: number
    time: number
    data: unknown
  }
  return {
    type: raw.type,
    seq: typeof raw.seq === 'number' ? raw.seq : 0,
    time: typeof raw.time === 'number' ? raw.time : 0,
    data: asRecord(raw.data) ?? {},
  }
}

/** Build the settled block a fact replays as. */
function blockOf(fact: LedgerBlockFact): SettledToolBlock {
  return {
    kind: 'tool-result',
    seq: fact.seq,
    time: fact.time,
    callId: fact.callId,
    name: fact.name,
    args: PartialArguments.fromText(fact.argsRaw),
    call: { name: fact.name, argsRaw: fact.argsRaw },
    callTime: fact.callTime,
    content: fact.content as unknown as readonly ContentBlock[],
    isError: fact.isError,
    ...(fact.error === undefined ? {} : { error: fact.error }),
    ...(fact.meta === undefined ? {} : { meta: fact.meta }),
    subCalls: [],
  }
}

/** Whether a settled block belongs in the trail. */
function belongsInTrail(block: SettledToolBlock): boolean {
  if (isZoteroTool(block.name)) return true
  return block.name === 'job_output' && receiptOf(block) !== null
}

/** Append one settled fact unless the call is already recorded. */
function record(state: SourceLedgerState, block: SettledToolBlock): SourceLedgerState {
  if (!belongsInTrail(block)) return state
  if (state.blocks.some((entry) => entry.callId === block.callId)) return state
  const fact: LedgerBlockFact = {
    callId: block.callId,
    seq: block.seq,
    time: block.time,
    name: block.name,
    argsRaw: block.call?.argsRaw ?? '',
    callTime: block.callTime ?? block.time,
    content: block.content as unknown as readonly JsonValue[],
    isError: block.isError,
    ...(block.error === undefined ? {} : { error: block.error }),
    ...(block.meta === undefined ? {} : { meta: block.meta as JsonValue }),
  }
  return { ...state, blocks: [...state.blocks, fact] }
}

/**
 * Fold one committed session event into the ledger.
 *
 * Unrelated events return the same state reference. Malformed payloads are
 * skipped rather than thrown: a throwing `apply` would fail every later read of
 * the Session's projections.
 * @param state - the current fold state.
 * @param event - the committed session event.
 * @returns the next state, or the same reference when nothing changed.
 */
export function foldLedgerEvent(state: SourceLedgerState, event: SessionEvent): SourceLedgerState {
  const raw = asEvent(event)
  switch (raw.type) {
    case 'turn/start':
      return Object.keys(state.pending).length === 0 ? state : { ...state, pending: {} }
    case 'tool/call': {
      const callId = asString(raw.data['callId'])
      const name = asString(raw.data['name'])
      const argsRaw = asString(raw.data['arguments'])
      if (callId === undefined || name === undefined || argsRaw === undefined) return state
      if (!isZoteroTool(name) && name !== 'job_output') return state
      return {
        ...state,
        pending: {
          ...state.pending,
          [callId]: { callId, name, argsRaw, seq: raw.seq, time: raw.time },
        },
      }
    }
    case 'tool/result': {
      const message = asRecord(raw.data['message'])
      const callId = message === undefined ? undefined : asString(message['toolCallId'])
      if (callId === undefined) return state
      const pending = state.pending[callId]
      if (pending === undefined) return state
      const content = Array.isArray(message?.['content'])
        ? (message!['content'] as JsonValue[])
        : []
      const block: SettledToolBlock = {
        kind: 'tool-result',
        seq: raw.seq,
        time: raw.time,
        callId,
        name: pending.name,
        args: PartialArguments.fromText(pending.argsRaw),
        call: { name: pending.name, argsRaw: pending.argsRaw },
        callTime: pending.time,
        content: content as unknown as readonly ContentBlock[],
        isError: message?.['isError'] === true,
        ...(asRecord(raw.data['error']) === undefined
          ? {}
          : { error: asRecord(raw.data['error']) as SettledToolBlock['error'] }),
        ...(raw.data['meta'] === undefined ? {} : { meta: raw.data['meta'] as JsonValue }),
        subCalls: [],
      }
      const pendingNext = { ...state.pending }
      delete pendingNext[callId]
      return record({ ...state, pending: pendingNext }, block)
    }
    case 'tool/ptc-dispatch-start': {
      const callId = asString(raw.data['subCallId'])
      const name = asString(raw.data['name'])
      if (callId === undefined || name === undefined || !isZoteroTool(name)) return state
      const args = raw.data['arguments']
      const argsRaw = typeof args === 'string' ? args : JSON.stringify(args ?? {})
      return {
        ...state,
        pending: {
          ...state.pending,
          [callId]: { callId, name, argsRaw, seq: raw.seq, time: raw.time },
        },
      }
    }
    case 'tool/ptc-dispatch': {
      const callId = asString(raw.data['subCallId'])
      const name = asString(raw.data['name'])
      if (callId === undefined || name === undefined) return state
      const args = raw.data['arguments']
      const argsRaw = typeof args === 'string' ? args : JSON.stringify(args ?? {})
      const content = Array.isArray(raw.data['content']) ? (raw.data['content'] as JsonValue[]) : []
      const block: SettledToolBlock = {
        kind: 'tool-result',
        seq: raw.seq,
        time: raw.time,
        callId,
        name,
        args: PartialArguments.fromText(argsRaw),
        call: { name, argsRaw },
        callTime: state.pending[callId]?.time ?? raw.time,
        content: content as unknown as readonly ContentBlock[],
        isError: raw.data['isError'] === true,
        ...(asRecord(raw.data['error']) === undefined
          ? {}
          : { error: asRecord(raw.data['error']) as SettledToolBlock['error'] }),
        ...(raw.data['meta'] === undefined ? {} : { meta: raw.data['meta'] as JsonValue }),
        subCalls: [],
      }
      const pendingNext = { ...state.pending }
      delete pendingNext[callId]
      return record({ ...state, pending: pendingNext }, block)
    }
    default:
      return state
  }
}

/**
 * The blocks a workspace build replays: settled outcomes plus the calls still
 * waiting, which the reducer counts as running operations.
 * @param state - the fold state.
 * @returns the ordered blocks.
 */
export function blocksOf(state: SourceLedgerState): readonly ToolBlockLike[] {
  const pending = Object.values(state.pending).map((call): ToolBlockLike => ({
    phase: 'start',
    callId: call.callId,
    name: call.name,
    args: PartialArguments.fromText(call.argsRaw),
    subCalls: [],
  }))
  return [...state.blocks.map(blockOf), ...pending]
}

/**
 * Build the rendered workspace from the current fold.
 * @param state - the fold state.
 * @param currentServerId - connected instance id, when the caller knows it.
 * @returns the aggregated workspace.
 */
export function workspaceOf(state: SourceLedgerState, currentServerId?: string): SourceWorkspace {
  return buildSourceWorkspace(blocksOf(state), {
    ...(currentServerId === undefined ? {} : { currentServerId }),
  })
}
