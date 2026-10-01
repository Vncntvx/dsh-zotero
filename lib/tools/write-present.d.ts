/**
 * Shared presentation for the write tools: the committed-unverified output
 * variant, its render and card titles, the create tools' result meta, and
 * the library-version line every write receipt ends with. One wording per
 * sentence — the tools must not drift on the retry-safety contract they
 * display.
 * @module dsh-zotero/tools/write-present
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools';
/**
 * The output-schema variant for the non-retryable committed-unverified
 * outcome every non-idempotent create (note, item, collection) can report.
 * One copy: the retry-safety contract the schema expresses must not drift
 * between tools.
 */
export declare const COMMITTED_UNVERIFIED_VARIANT: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly kind: {
            readonly type: "string";
            readonly enum: readonly ["committed-unverified"];
            readonly required: true;
        };
        readonly committed: {
            readonly type: "boolean";
            readonly enum: readonly [true];
            readonly required: true;
        };
        readonly retryable: {
            readonly type: "boolean";
            readonly enum: readonly [false];
            readonly required: true;
        };
        readonly reason: {
            readonly type: "string";
            readonly enum: readonly ["saved-state-unverified", "commit-unknown"];
            readonly required: true;
        };
        readonly ref: {
            readonly type: "string";
        };
        readonly key: {
            readonly type: "string";
        };
        readonly version: {
            readonly type: "integer";
        };
        readonly libraryVersion: {
            readonly type: "integer";
        };
        readonly serverId: {
            readonly type: "string";
            readonly required: true;
        };
    };
};
/** The fields the shared committed-unverified render and meta read. */
export interface CommittedUnverifiedLike {
    readonly kind: 'committed-unverified';
    readonly reason: 'saved-state-unverified' | 'commit-unknown';
    readonly ref?: string;
    readonly key?: string;
    readonly version?: number;
}
/**
 * Render the committed-unverified receipt: what Zotero may have done (the
 * past verb differs per create), the identity hint when the response carried
 * one, and the reconciliation instruction — never a retry.
 */
export declare function renderCommittedUnverified(value: CommittedUnverifiedLike, objectName: string, pastVerb: 'committed' | 'created'): ContentBlock[];
/**
 * The result-card titles for one create tool: declined, the two
 * committed-unverified reasons, and the applied receipt with its ref.
 */
export declare function presentCreateResultView(noun: string, pastVerb: 'committed' | 'created', result: ToolResult): ToolResultView | undefined;
/** The presentation meta the create tools project for the Sources panel. */
export declare function createWritePresentationMeta(value: {
    kind: 'applied';
    ref: string;
    key: string;
    version: number;
} | CommittedUnverifiedLike | {
    kind: 'declined';
}): JsonValue;
/**
 * The presentation meta the two list-update tools (tags, membership)
 * project: the change counts ride the applied arm so the Sources panel can
 * summarize the diff without re-reading the lists.
 */
export declare function listUpdatePresentationMeta(value: {
    kind: 'applied';
    ref: string;
    version: number;
    added: readonly unknown[];
    removed: readonly unknown[];
} | {
    kind: 'declined';
}): JsonValue;
/** The closing line of every write receipt: the library version and its serving instance. */
export declare function libraryVersionLine(value: {
    libraryVersion: number;
    serverId?: string;
}): string;
//# sourceMappingURL=write-present.d.ts.map