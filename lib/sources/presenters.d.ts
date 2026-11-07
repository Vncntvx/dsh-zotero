/**
 * Pure block readers shared by the Sources panel.
 * Extracts call state, presentation facts, and tool arguments from frozen blocks.
 * @module dsh-zotero/sources/presenters
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ArgsView, ToolBlockLike } from './block-types.js';
import type { EvidenceItem } from '../evidence-item.js';
export type ZoteroRowState = 'running' | 'ok' | 'error' | 'stopped';
/**
 * True when a call block carries its settled result. Local mirror of the
 * harness's `isSettledTool`
 * (`packages/client/ui-chat/src/client/contract/chat-nodes.ts`): that helper
 * lives in a client entry whose runtime bundle requires the loader
 * environment, so this shared module keeps its harness imports type-only and
 * carries the one-line predicate locally instead of value-importing it.
 */
export declare function isSettledTool(block: ToolBlockLike): block is Extract<ToolBlockLike, {
    kind: 'tool-result';
}>;
/**
 * True while a call is still running, in either of the two running phases:
 * `preparing` (arguments still streaming, so the card has no parsed args yet)
 * and `start` (dispatched, awaiting its result). Cards use this to pick their
 * in-progress copy; testing `phase === 'start'` alone would show a preparing
 * call the settled fallback instead.
 */
export declare function isToolRunning(block: ToolBlockLike): boolean;
/** The wire name of one tool call block (settled and running forms). */
export declare function callNameOf(block: ToolBlockLike): string | null;
/** The validated presentation-meta object, or null when absent or malformed. */
export declare function metaOf(block: ToolBlockLike): Record<string, unknown> | null;
/** Lifecycle state derived from the frozen block, independent of meta. */
export declare function rowStateOf(block: ToolBlockLike): ZoteroRowState;
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
export declare function resultTextOf(block: ToolBlockLike): string | null;
/** Single-line error summary derived from settled error content, or null when not errored. */
export declare function errorSummaryOf(block: ToolBlockLike, rawText?: string | null): string | null;
/**
 * The block's argument view, materialized by the harness on every call head
 * and result (`ToolCallHead.args` / `ToolResultNode.args`).
 * @param block - call block to read.
 * @returns the block's argument view.
 */
export declare function argsViewOf(block: ToolBlockLike): ArgsView;
/** A string argument, including the streaming prefix while it is still open. */
export declare function textArg(view: ArgsView, key: string): string | undefined;
/** A non-string argument; undefined while that field is still open or absent. */
export declare function valueArg(view: ArgsView, key: string): JsonValue | undefined;
/** String entries of an array argument; empty when absent, incomplete, or not an array. */
export declare function listArg(view: ArgsView, key: string): string[];
/** A non-negative finite numeric argument, or `fallback` when absent or unusable. */
export declare function numberArg(view: ArgsView, key: string, fallback?: number): number;
/** A boolean argument: true only for a completed JSON `true`. */
export declare function boolArg(view: ArgsView, key: string): boolean;
/** A plain-object argument, or null when absent, incomplete, or not an object. */
export declare function recordArg(view: ArgsView, key: string): Record<string, unknown> | null;
/** The 8-character object key of a zotero:// ref, or null for other strings. */
export declare function shortKeyOf(value: string): string | null;
/** Evidence items from the retrieve projection; null when malformed. */
export declare function evidenceItemsOf(meta: Record<string, unknown>): EvidenceItem[] | null;
/** Join a metadata line's non-empty parts with the middot separator. */
export declare function joinNonEmpty(...parts: Array<string | number | undefined>): string;
/**
 * Format a Date or timestamp as `HH:MM:SS` (default) or `HH:MM`.
 * Shared across diagnostics, sources tab, and export artifacts.
 */
export declare function formatTime(dateOrMs: Date | number, includeSeconds?: boolean): string;
//# sourceMappingURL=presenters.d.ts.map