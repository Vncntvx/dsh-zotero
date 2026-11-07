/**
 * Pure block readers shared by the Sources panel.
 * Extracts call state, presentation facts, and tool arguments from frozen blocks.
 * @module dsh-zotero/sources/presenters
 */
import { isEvidenceSource } from '../evidence-item.js';
import { boolField, isRecord, stringField } from '../json.js';
import { REF_IN_TEXT_PATTERN } from '../ref-grammar.js';
/**
 * True when a call block carries its settled result. Local mirror of the
 * harness's `isSettledTool`
 * (`packages/client/ui-chat/src/client/contract/chat-nodes.ts`): that helper
 * lives in a client entry whose runtime bundle requires the loader
 * environment, so this shared module keeps its harness imports type-only and
 * carries the one-line predicate locally instead of value-importing it.
 */
export function isSettledTool(block) {
    return 'kind' in block;
}
/**
 * True while a call is still running, in either of the two running phases:
 * `preparing` (arguments still streaming, so the card has no parsed args yet)
 * and `start` (dispatched, awaiting its result). Cards use this to pick their
 * in-progress copy; testing `phase === 'start'` alone would show a preparing
 * call the settled fallback instead.
 */
export function isToolRunning(block) {
    return !isSettledTool(block);
}
/** The wire name of one tool call block (settled and running forms). */
export function callNameOf(block) {
    return isSettledTool(block) ? (block.call?.name ?? null) : block.name;
}
/** The validated presentation-meta object, or null when absent or malformed. */
export function metaOf(block) {
    if (!isSettledTool(block))
        return null;
    return isRecord(block.meta) ? block.meta : null;
}
/** Lifecycle state derived from the frozen block, independent of meta. */
export function rowStateOf(block) {
    if (!isSettledTool(block))
        return 'running';
    if (block.error?.code === 'interrupted')
        return 'stopped';
    return block.isError ? 'error' : 'ok';
}
/**
 * Flatten settled content blocks to display text. Settled semantics match the
 * harness `resultText`
 * (`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts`)
 * exactly: text blocks verbatim, other block shapes as pretty JSON, empty
 * content on a failed call falling back to the structured error's
 * `name: code` line, otherwise the empty string. Running blocks return null
 * (the harness helper only accepts settled nodes); callers normalize with
 * `?? ''`.
 */
export function resultTextOf(block) {
    if (!isSettledTool(block))
        return null;
    const parts = [];
    for (const item of block.content) {
        if (item.type === 'text')
            parts.push(item.text);
        else
            parts.push(JSON.stringify(item, null, 2));
    }
    if (parts.length === 0 && block.error !== undefined) {
        parts.push(`${block.error.name}: ${block.error.code}`);
    }
    if (parts.length === 0)
        return '';
    return parts.join('\n');
}
/** Single-line error summary derived from settled error content, or null when not errored. */
export function errorSummaryOf(block, rawText) {
    if (rowStateOf(block) !== 'error')
        return null;
    const text = rawText !== undefined ? rawText : resultTextOf(block);
    return text ? text.split('\n')[0]?.trim() || null : null;
}
/**
 * The block's argument view, materialized by the harness on every call head
 * and result (`ToolCallHead.args` / `ToolResultNode.args`).
 * @param block - call block to read.
 * @returns the block's argument view.
 */
export function argsViewOf(block) {
    return block.args;
}
/** A string argument, including the streaming prefix while it is still open. */
export function textArg(view, key) {
    return view.text(key);
}
/** A non-string argument; undefined while that field is still open or absent. */
export function valueArg(view, key) {
    return view.value(key);
}
/** String entries of an array argument; empty when absent, incomplete, or not an array. */
export function listArg(view, key) {
    const value = valueArg(view, key);
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : [];
}
/** A non-negative finite numeric argument, or `fallback` when absent or unusable. */
export function numberArg(view, key, fallback = 0) {
    const value = valueArg(view, key);
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
/** A boolean argument: true only for a completed JSON `true`. */
export function boolArg(view, key) {
    return valueArg(view, key) === true;
}
/** A plain-object argument, or null when absent, incomplete, or not an object. */
export function recordArg(view, key) {
    const value = valueArg(view, key);
    return isRecord(value) ? value : null;
}
/** The 8-character object key of a zotero:// ref, or null for other strings. */
export function shortKeyOf(value) {
    return REF_IN_TEXT_PATTERN.exec(value)?.groups?.key ?? null;
}
/** Evidence items from the retrieve projection; null when malformed. */
export function evidenceItemsOf(meta) {
    const items = meta['items'];
    if (!Array.isArray(items))
        return null;
    const rows = [];
    for (const item of items) {
        if (!isRecord(item))
            return null;
        const source = stringField(item, 'source');
        const sourceRef = stringField(item, 'sourceRef');
        const preview = stringField(item, 'preview');
        if (source === undefined || sourceRef === undefined || preview === undefined)
            return null;
        // The source must be the wire's own vocabulary: an unchecked cast would
        // let an unknown string through to the labels, which would misreport the
        // passage's provenance instead of rejecting the malformed meta.
        if (!isEvidenceSource(source))
            return null;
        const previewTruncated = boolField(item, 'previewTruncated') === true;
        const pageLabel = stringField(item, 'pageLabel');
        const attachmentRef = stringField(item, 'attachmentRef');
        const matchedFields = matchedFieldsOf(item['matchedFields']);
        rows.push({
            source,
            sourceRef,
            preview,
            previewTruncated,
            ...(pageLabel === undefined ? {} : { pageLabel }),
            ...(attachmentRef === undefined ? {} : { attachmentRef }),
            ...(matchedFields === undefined ? {} : { matchedFields }),
        });
    }
    return rows;
}
/**
 * The two-field names a passage reports, keeping only the wire's own
 * vocabulary. Anything else (an unknown name, a non-array) reads as absent,
 * which is the single-field case the badge does not need to distinguish.
 */
function matchedFieldsOf(value) {
    if (!Array.isArray(value))
        return undefined;
    const fields = value.filter((entry) => entry === 'text' || entry === 'comment');
    return fields.length === 0 ? undefined : fields;
}
/** Join a metadata line's non-empty parts with the middot separator. */
export function joinNonEmpty(...parts) {
    return parts.filter((part) => part !== undefined && part !== '').join(' · ');
}
/**
 * Format a Date or timestamp as `HH:MM:SS` (default) or `HH:MM`.
 * Shared across diagnostics, sources tab, and export artifacts.
 */
export function formatTime(dateOrMs, includeSeconds = true) {
    const date = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
    const pad = (value) => String(value).padStart(2, '0');
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    if (!includeSeconds) {
        return `${hours}:${minutes}`;
    }
    return `${hours}:${minutes}:${pad(date.getSeconds())}`;
}
//# sourceMappingURL=presenters.js.map