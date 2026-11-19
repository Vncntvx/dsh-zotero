/**
 * Structural block shapes shared by the host source ledger and the browser
 * panel. They mirror the harness chat projection's tool nodes without
 * importing the client program's Context merges into the host: only the fields
 * the ledger actually reads are declared, and a real `ToolCallBlock` satisfies
 * them structurally.
 * @module dsh-zotero/sources/block-types
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
/** Lazy argument view: the two reads the source decoders perform. */
export interface ArgsView {
    /** Whether the argument JSON failed to parse. */
    readonly invalid: boolean;
    /** Whether the field is present in the parsed payload. */
    has(key: string): boolean;
    text(key: string): string | undefined;
    value(key: string): JsonValue | undefined;
}
/** Structured failure identity carried by a settled tool result. */
export interface ToolBlockError {
    readonly name: string;
    readonly code: string;
    readonly reason?: string;
}
/** A settled tool result, structurally compatible with `ToolResultNode`. */
export interface SettledToolBlock {
    readonly kind: 'tool-result';
    readonly seq: number;
    readonly time: number;
    readonly callId: string;
    readonly name: string;
    readonly args: ArgsView;
    readonly call: {
        readonly name: string;
        readonly argsRaw: string;
    } | null;
    readonly callTime: number | null;
    readonly content: readonly ContentBlock[];
    readonly isError: boolean;
    readonly error?: ToolBlockError;
    readonly meta?: unknown;
    readonly subCalls: readonly ToolBlockLike[];
}
/** A tool call that has not settled, structurally compatible with the running arms. */
export interface RunningToolBlock {
    readonly phase: 'preparing' | 'start';
    readonly callId: string;
    readonly name: string;
    readonly args: ArgsView;
    readonly subCalls: readonly ToolBlockLike[];
}
/** One preparing, dispatched, or settled tool block. */
export type ToolBlockLike = SettledToolBlock | RunningToolBlock;
//# sourceMappingURL=block-types.d.ts.map