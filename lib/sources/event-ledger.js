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
import { PartialArguments } from '@deepseek-ai/dsh-util-values';
import { asRecord, asString } from '../json.js';
import { buildSourceWorkspace } from './ledger.js';
import { receiptOf } from './receipt.js';
/** One append copies at most this many facts. */
const BLOCK_CHUNK_SIZE = 256;
/** The empty fold state. */
export function emptyLedgerState() {
    return { blockChunks: [], pending: {}, recorded: {} };
}
/** How many settled facts the state holds. */
export function blockCountOf(state) {
    let count = 0;
    for (const chunk of state.blockChunks)
        count += chunk.length;
    return count;
}
/** Every settled fact, flattened. Used by a rebuild, not by the per-event fold. */
export function factsOf(state) {
    return state.blockChunks.flat();
}
/**
 * The settled facts at or after one transcript index, without flattening the
 * prefix the caller already folded.
 * @param state - the fold state.
 * @param start - the first fact index to return.
 * @returns the facts in transcript order.
 */
export function factsFrom(state, start) {
    const facts = [];
    let base = 0;
    for (const chunk of state.blockChunks) {
        if (start < base + chunk.length) {
            facts.push(...chunk.slice(Math.max(0, start - base)));
        }
        base += chunk.length;
    }
    return facts;
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
const TRAIL_TOOL_NAMES = new Set([
    'zotero_search',
    'zotero_get',
    'zotero_get_batch',
    'zotero_match_references',
    'zotero_retrieve',
    'zotero_export',
]);
/** Whether a tool name is one the literature trail records. */
function isTrailTool(name) {
    return TRAIL_TOOL_NAMES.has(name);
}
/**
 * The JSON/block content boundary. The ledger persists outcomes as pure JSON
 * (the durable event payload's own type) and replays them as content blocks
 * the workspace builder reads. The two shapes are compatible by construction:
 * `record` writes block content into a fact, and facts are only ever built
 * from block content, so the re-interpretation is declared once here instead
 * of scattered as per-call-site casts.
 */
function contentAsBlocks(content) {
    return content;
}
/** The reverse direction of {@link contentAsBlocks}, persisting a block as pure JSON. */
function blocksAsContent(content) {
    return content;
}
function asEvent(event) {
    return {
        type: event.type,
        seq: typeof event.seq === 'number' ? event.seq : 0,
        time: typeof event.time === 'number' ? event.time : 0,
        data: asRecord(event.data) ?? {},
    };
}
/** Build the settled block a fact replays as. */
export function settledBlockOf(fact) {
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
    };
}
/** Whether a settled block belongs in the trail. */
function belongsInTrail(block) {
    if (isTrailTool(block.name))
        return true;
    return block.name === 'job_output' && receiptOf(block) !== null;
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
function record(state, block, tracked) {
    if (!belongsInTrail(block))
        return state;
    if (state.recorded[block.callId] === true)
        return state;
    const fact = {
        callId: block.callId,
        seq: block.seq,
        time: block.time,
        name: block.name,
        argsRaw: block.call?.argsRaw ?? '',
        callTime: block.callTime ?? block.time,
        content: blocksAsContent(block.content),
        isError: block.isError,
        ...(block.error === undefined ? {} : { error: block.error }),
        ...(block.meta === undefined ? {} : { meta: block.meta }),
    };
    const last = state.blockChunks[state.blockChunks.length - 1];
    const blockChunks = last !== undefined && last.length < BLOCK_CHUNK_SIZE
        ? [...state.blockChunks.slice(0, -1), [...last, fact]]
        : [...state.blockChunks, [fact]];
    return {
        ...state,
        blockChunks,
        ...(tracked ? { recorded: { ...state.recorded, [block.callId]: true } } : {}),
    };
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
export function foldLedgerEvent(state, event) {
    const raw = asEvent(event);
    switch (raw.type) {
        case 'turn/start':
            return Object.keys(state.pending).length === 0 ? state : { ...state, pending: {} };
        case 'tool/call': {
            const callId = asString(raw.data['callId']);
            const name = asString(raw.data['name']);
            const argsRaw = asString(raw.data['arguments']);
            if (callId === undefined || name === undefined || argsRaw === undefined)
                return state;
            if (!isTrailTool(name) && name !== 'job_output')
                return state;
            return {
                ...state,
                pending: {
                    ...state.pending,
                    [callId]: { callId, name, argsRaw, seq: raw.seq, time: raw.time },
                },
            };
        }
        case 'tool/result': {
            const message = asRecord(raw.data['message']);
            const callId = message === undefined ? undefined : asString(message['toolCallId']);
            if (callId === undefined)
                return state;
            const pending = state.pending[callId];
            if (pending === undefined)
                return state;
            const content = Array.isArray(message?.['content'])
                ? message['content']
                : [];
            const block = {
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
                    : { error: asRecord(raw.data['error']) }),
                ...(raw.data['meta'] === undefined ? {} : { meta: raw.data['meta'] }),
                subCalls: [],
            };
            const pendingNext = { ...state.pending };
            delete pendingNext[callId];
            return record({ ...state, pending: pendingNext }, block, false);
        }
        case 'tool/ptc-dispatch-start': {
            const callId = asString(raw.data['subCallId']);
            const name = asString(raw.data['name']);
            if (callId === undefined || name === undefined || !isTrailTool(name))
                return state;
            const args = raw.data['arguments'];
            const argsRaw = typeof args === 'string' ? args : JSON.stringify(args ?? {});
            return {
                ...state,
                pending: {
                    ...state.pending,
                    [callId]: { callId, name, argsRaw, seq: raw.seq, time: raw.time },
                },
            };
        }
        case 'tool/ptc-dispatch': {
            const callId = asString(raw.data['subCallId']);
            const name = asString(raw.data['name']);
            if (callId === undefined || name === undefined)
                return state;
            const args = raw.data['arguments'];
            const argsRaw = typeof args === 'string' ? args : JSON.stringify(args ?? {});
            const content = Array.isArray(raw.data['content']) ? raw.data['content'] : [];
            const block = {
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
                    : { error: asRecord(raw.data['error']) }),
                ...(raw.data['meta'] === undefined ? {} : { meta: raw.data['meta'] }),
                subCalls: [],
            };
            const pendingNext = { ...state.pending };
            delete pendingNext[callId];
            return record({ ...state, pending: pendingNext }, block, true);
        }
        default:
            return state;
    }
}
/**
 * The calls still waiting for their result, as the running blocks the
 * workspace reducer counts as running operations. They always follow every
 * settled block: a call without a result has no transcript position yet.
 * @param state - the fold state.
 * @returns the running blocks, in first-seen order.
 */
export function pendingBlocksOf(state) {
    return Object.values(state.pending).map((call) => ({
        phase: 'start',
        callId: call.callId,
        name: call.name,
        args: PartialArguments.fromText(call.argsRaw),
        subCalls: [],
    }));
}
/**
 * The blocks a workspace build replays: settled outcomes plus the calls still
 * waiting, which the reducer counts as running operations.
 * @param state - the fold state.
 * @returns the ordered blocks.
 */
export function blocksOf(state) {
    return [...factsOf(state).map(settledBlockOf), ...pendingBlocksOf(state)];
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
export function workspaceOf(state, currentServerId) {
    return buildSourceWorkspace(blocksOf(state), {
        ...(currentServerId === undefined ? {} : { currentServerId }),
    });
}
//# sourceMappingURL=event-ledger.js.map