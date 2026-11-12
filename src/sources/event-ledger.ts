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
import { ZOTERO_READ_TOOL_NAMES } from '../constants.js'
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
  /**
   * Call ids that need a durable dedupe: the ones a `tool/ptc-dispatch`
   * settled, because that arm records without a pending entry (a dispatch may
   * outlive its turn). The tool/result arm needs no record — its pending entry
   * is the dedupe and is deleted in the same step — so this stays small even on
   * a long session. A Set cannot survive the strict zod state schema, so the
   * ids ride the state as a plain record.
   */
  readonly recorded: Readonly<Record<string, true>>
}

/** The projection state: the fold plus the fork-inherited prefix length. */
export interface SourceLedgerProjectionState {
  readonly inheritedEventCount: number
  readonly ledger: SourceLedgerState
}

/** The empty fold state. */
export function emptyLedgerState(): SourceLedgerState {
  return { blocks: [], pending: {}, recorded: {} }
}

/**
 * The tools whose calls the literature trail records.
 *
 * A name prefix was the old rule, and it admitted every write tool: their
 * arguments and results were folded into the projection state and kept for the
 * session even though no view consumes them, while the surface contract says
 * the trail holds reads and exports only. The read list is the same constant
 * the prompt and the client use, so adding a read tool adds it here.
 */
const TRAIL_TOOL_NAMES: ReadonlySet<string> = new Set(ZOTERO_READ_TOOL_NAMES)

/** Whether a tool name is one the literature trail records. */
function isTrailTool(name: string): boolean {
  return TRAIL_TOOL_NAMES.has(name)
}

/**
 * The JSON/block content boundary. The ledger persists outcomes as pure JSON
 * (the durable event payload's own type) and replays them as content blocks
 * the workspace builder reads. The two shapes are compatible by construction:
 * `record` writes block content into a fact, and facts are only ever built
 * from block content, so the re-interpretation is declared once here instead
 * of scattered as per-call-site casts.
 */
function contentAsBlocks(content: readonly JsonValue[]): readonly ContentBlock[] {
  return content as unknown as readonly ContentBlock[]
}

/** The reverse direction of {@link contentAsBlocks}, persisting a block as pure JSON. */
function blocksAsContent(content: readonly ContentBlock[]): readonly JsonValue[] {
  return content as unknown as readonly JsonValue[]
}

/** Narrow one raw event to the structural fields the fold reads. */
interface LedgerEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: Record<string, unknown>
}

function asEvent(event: SessionEvent): LedgerEvent {
  return {
    type: event.type,
    seq: typeof event.seq === 'number' ? event.seq : 0,
    time: typeof event.time === 'number' ? event.time : 0,
    data: asRecord(event.data) ?? {},
  }
}

/** Build the settled block a fact replays as. */
export function settledBlockOf(fact: LedgerBlockFact): SettledToolBlock {
  return {
    kind: 'tool-result',
    seq: fact.seq,
    time: fact.time,
    callId: fact.callId,
    name: fact.name,
    args: PartialArguments.fromText(fact.argsRaw),
    call: { name: fact.name, argsRaw: fact.argsRaw },
    callTime: fact.callTime,
    content: contentAsBlocks(fact.content),
    isError: fact.isError,
    ...(fact.error === undefined ? {} : { error: fact.error }),
    ...(fact.meta === undefined ? {} : { meta: fact.meta }),
    subCalls: [],
  }
}

/** Whether a settled block belongs in the trail. */
function belongsInTrail(block: SettledToolBlock): boolean {
  if (isTrailTool(block.name)) return true
  return block.name === 'job_output' && receiptOf(block) !== null
}

/**
 * Append one settled fact, keeping the durable dedupe only where it is owed.
 *
 * The tool/result arm can only reach here with its pending entry intact, and
 * it deletes that entry in the same step: a repeated result finds no pending
 * entry and never arrives, so its callId needs no record. The ptc-dispatch arm
 * records without a pending requirement — a dispatch may outlive its turn — so
 * the recorded set is what makes a repeated dispatch event a no-op. Writing
 * every settled result's callId there instead copied the whole record once per
 * call, which is the fold's quadratic term on a long session.
 * @param state - the current fold state.
 * @param block - the settled block to append.
 * @param tracked - whether this call id needs the durable dedupe (ptc dispatch only).
 * @returns the next state, or the same reference when nothing changed.
 */
function record(
  state: SourceLedgerState,
  block: SettledToolBlock,
  tracked: boolean,
): SourceLedgerState {
  if (!belongsInTrail(block)) return state
  if (state.recorded[block.callId] === true) return state
  const fact: LedgerBlockFact = {
    callId: block.callId,
    seq: block.seq,
    time: block.time,
    name: block.name,
    argsRaw: block.call?.argsRaw ?? '',
    callTime: block.callTime ?? block.time,
    content: blocksAsContent(block.content),
    isError: block.isError,
    ...(block.error === undefined ? {} : { error: block.error }),
    ...(block.meta === undefined ? {} : { meta: block.meta as JsonValue }),
  }
  return {
    ...state,
    blocks: [...state.blocks, fact],
    ...(tracked ? { recorded: { ...state.recorded, [block.callId]: true } } : {}),
  }
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
      if (!isTrailTool(name) && name !== 'job_output') return state
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
        content: contentAsBlocks(content),
        isError: message?.['isError'] === true,
        ...(asRecord(raw.data['error']) === undefined
          ? {}
          : { error: asRecord(raw.data['error']) as SettledToolBlock['error'] }),
        ...(raw.data['meta'] === undefined ? {} : { meta: raw.data['meta'] as JsonValue }),
        subCalls: [],
      }
      const pendingNext = { ...state.pending }
      delete pendingNext[callId]
      return record({ ...state, pending: pendingNext }, block, false)
    }
    case 'tool/ptc-dispatch-start': {
      const callId = asString(raw.data['subCallId'])
      const name = asString(raw.data['name'])
      if (callId === undefined || name === undefined || !isTrailTool(name)) return state
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
        content: contentAsBlocks(content),
        isError: raw.data['isError'] === true,
        ...(asRecord(raw.data['error']) === undefined
          ? {}
          : { error: asRecord(raw.data['error']) as SettledToolBlock['error'] }),
        ...(raw.data['meta'] === undefined ? {} : { meta: raw.data['meta'] as JsonValue }),
        subCalls: [],
      }
      const pendingNext = { ...state.pending }
      delete pendingNext[callId]
      return record({ ...state, pending: pendingNext }, block, true)
    }
    default:
      return state
  }
}

/**
 * The calls still waiting for their result, as the running blocks the
 * workspace reducer counts as running operations. They always follow every
 * settled block: a call without a result has no transcript position yet.
 * @param state - the fold state.
 * @returns the running blocks, in first-seen order.
 */
export function pendingBlocksOf(state: SourceLedgerState): readonly ToolBlockLike[] {
  return Object.values(state.pending).map((call): ToolBlockLike => ({
    phase: 'start',
    callId: call.callId,
    name: call.name,
    args: PartialArguments.fromText(call.argsRaw),
    subCalls: [],
  }))
}

/**
 * The blocks a workspace build replays: settled outcomes plus the calls still
 * waiting, which the reducer counts as running operations.
 * @param state - the fold state.
 * @returns the ordered blocks.
 */
export function blocksOf(state: SourceLedgerState): readonly ToolBlockLike[] {
  return [...state.blocks.map(settledBlockOf), ...pendingBlocksOf(state)]
}

/**
 * Build the rendered workspace from the current fold in one pass.
 *
 * The host projection does not call this: it keeps a
 * `SourceWorkspaceIndex` per session state chain and folds only the new
 * blocks, because a per-event full replay is quadratic in the session length.
 * This one-shot form serves callers that hold the whole block list once.
 * @param state - the fold state.
 * @param currentServerId - connected instance id, when the caller knows it.
 * @returns the aggregated workspace.
 */
export function workspaceOf(state: SourceLedgerState, currentServerId?: string): SourceWorkspace {
  return buildSourceWorkspace(blocksOf(state), {
    ...(currentServerId === undefined ? {} : { currentServerId }),
  })
}
