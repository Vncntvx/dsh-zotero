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
 * True when a call block carries its settled result.
 *
 * The harness does export its own `isSettledTool` from
 * `@deepseek-ai/dsh-client-ui-chat/client`, but this module is also loaded by
 * the host half, which must not load a client entry; the local mirror keeps the
 * check type-only. It is still a mirror: re-check the upstream predicate on
 * every pin upgrade (`docs/development.md`, the pin checklist).
 */
export declare function isSettledTool(block: ToolBlockLike): block is Extract<ToolBlockLike, {
    kind: 'tool-result';
}>;
/**
 * True while a call is running, in either `preparing` (arguments still
 * streaming, no parsed args) or `start` (dispatched, awaiting result). Cards
 * use this to select their in-progress copy; checking `phase === 'start'` alone
 * shows a preparing call the settled fallback.
 */
export declare function isToolRunning(block: ToolBlockLike): boolean;
/** The wire name of one tool call block (settled and running forms). */
export declare function callNameOf(block: ToolBlockLike): string | null;
/** The validated presentation-meta object, or null when absent or malformed. */
export declare function metaOf(block: ToolBlockLike): Record<string, unknown> | null;
/** Lifecycle state derived from the frozen block, independent of meta. */
export declare function rowStateOf(block: ToolBlockLike): ZoteroRowState;
/**
 * The first text block of a settled result: the artifact bytes a card copies
 * or downloads, kept apart from any block the render appends after it.
 * Running blocks return null.
 */
export declare function resultFirstTextOf(block: ToolBlockLike): string | null;
/**
 * Flatten settled content blocks to display text. The harness's `resultText`
 * (`packages/client/ui-tool/src/client/tool/models/tool-call-model.ts`) is not
 * exported from its package's `./client` entry, so a mirror is the only option;
 * the semantics are copied exactly: text blocks verbatim, other block shapes as
 * pretty JSON, empty content on a failed call falling back to the structured
 * error's `name: code` line, otherwise the empty string. Running blocks return
 * null (the harness helper only accepts settled nodes); callers normalize with
 * `?? ''`. Re-check it on every pin upgrade (`docs/development.md`).
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
/**
 * Format a Date or timestamp as `YYYY/MM/DD HH:MM`, the absolute date a dated
 * row shows beside its size. Digits only, so zh and en read it the same way.
 */
export declare function formatDateTime(dateOrMs: Date | number): string;
//# sourceMappingURL=presenters.d.ts.map