/**
 * The host-side event fold of the literature trail: a compact, JSON-only
 * record of the session's Zotero tool outcomes, consumed by the incremental
 * source projection.
 *
 * State holds arguments and presentation facts. Only exports and valid durable
 * receipts retain content blocks; other tool bodies already live in the
 * session event log. The incremental workspace index owns aggregation.
 * @module dsh-zotero/sources/event-ledger
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import {
  appendChunkedList,
  iterateChunkedList,
  type ChunkedList,
} from '@deepseek-ai/dsh-chunked-list'
import { asRecord, asString } from '../json.js'
import { receiptOf } from './receipt.js'
import type { SettledToolBlock, ToolBlockLike } from './block-types.js'

/** One settled Zotero outcome as pure JSON. */
interface LedgerBlockFact {
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
interface LedgerPendingCall {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
  readonly seq: number
  readonly time: number
}

/** The fold state: settled facts in transcript order plus unsettled calls. */
export interface SourceLedgerState {
  /**
   * Settled facts in transcript order, as the harness chunked list: an append
   * copies at most one 64-value chunk and shares every older one, and the
   * recursive zod schema validates checkpointed shapes (absent = empty).
   */
  readonly blockChunks?: ChunkedList<LedgerBlockFact> | undefined
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

/** The projection state: the complete durable fold. */
export interface SourceLedgerProjectionState {
  readonly ledger: SourceLedgerState
}

/** The empty fold state. */
export function emptyLedgerState(): SourceLedgerState {
  return { pending: {}, recorded: {} }
}

/** How many settled facts the state holds. */
export function blockCountOf(state: SourceLedgerState): number {
  let count = 0
  for (const _fact of iterateChunkedList(state.blockChunks)) count += 1
  return count
}

/** Every settled fact, flattened. Used by a rebuild, not by the per-event fold. */
export function factsOf(state: SourceLedgerState): readonly LedgerBlockFact[] {
  return [...iterateChunkedList(state.blockChunks)]
}

/**
 * The settled facts at or after one transcript index, without materializing the
 * prefix the caller already folded.
 * @param state - the fold state.
 * @param start - the first fact index to return.
 * @returns the facts in transcript order.
 */
export function factsFrom(state: SourceLedgerState, start: number): readonly LedgerBlockFact[] {
  const facts: LedgerBlockFact[] = []
  let index = 0
  for (const fact of iterateChunkedList(state.blockChunks)) {
    if (index >= start) facts.push(fact)
    index += 1
  }
  return facts
}

/**
 * The tool names the literature trail folds into its projection state.
 *
 * These are exactly the names with a fold arm; browse, changes, and the write
 * tools are read calls the trail surfaces do not consume, so recording them
 * would keep their arguments, content, and metadata in the session state for
 * no view. `job_output` is admitted separately because it can carry a
 * completed export result through its receipt.
 */
const TRAIL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'zotero_search',
  'zotero_get',
  'zotero_get_batch',
  'zotero_match_references',
  'zotero_retrieve',
  'zotero_search_parsed',
  'zotero_export',
])

/** Whether a tool name is one the literature trail records. */
function isTrailTool(name: string): boolean {
  return TRAIL_TOOL_NAMES.has(name)
}

/**
 * The JSON/block content boundary. The ledger persists outcomes as pure JSON
 * (the durable event payload's own type) and replays them as content blocks
 * the workspace builder reads. The two shapes are compatible by construction:
 * `record` writes block content into a fact, and facts are only ever built
 * from block content, so the re-interpretation is declared once per direction
 * here instead of scattered as per-call-site casts. The double assertion is
 * load-bearing: `ContentBlock`'s members are named interfaces, which TypeScript
 * does not relate to the JSON index-signature record, so neither direction is
 * comparable enough for a single cast — and a validating rewrite would change
 * what the fold accepts on this hot path.
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
  if (block.name !== 'job_output') return false
  const receipt = receiptOf(block)
  return typeof receipt?.tool === 'string' && isTrailTool(receipt.tool)
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
    content:
      block.name === 'zotero_export' || receiptOf(block) !== null
        ? blocksAsContent(block.content)
        : [],
    isError: block.isError,
    ...(block.error === undefined ? {} : { error: block.error }),
    ...(block.meta === undefined ? {} : { meta: block.meta as JsonValue }),
  }
  return {
    ...state,
    blockChunks: appendChunkedList(state.blockChunks, fact),
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
