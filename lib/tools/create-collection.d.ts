/**
 * The `zotero_create_collection` tool: create a collection, optionally under a
 * parent. A sibling that already carries the name refuses the write before any
 * POST. The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/create-collection
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const CREATE_COLLECTION_PARAMETERS: {
    readonly name: {
        readonly type: "string";
        readonly required: true;
        readonly description: "The new collection name (non-blank). A sibling with the same name refuses the write.";
    };
    readonly parent: {
        readonly type: "string";
        readonly description: "The parent collection: a zotero://user/0/collection/<KEY> ref or an exact name. Omit for a top-level collection.";
    };
};
type CreateCollectionArgs = InferArgs<typeof CREATE_COLLECTION_PARAMETERS>;
declare const CREATE_COLLECTION_OUTPUT_SCHEMA: {
    readonly oneOf: readonly [{
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["declined"];
                readonly required: true;
            };
        };
    }, {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["applied"];
                readonly required: true;
            };
            readonly ref: {
                readonly type: "string";
                readonly required: true;
            };
            readonly key: {
                readonly type: "string";
                readonly required: true;
            };
            readonly version: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly name: {
                readonly type: "string";
                readonly required: true;
            };
            readonly parentRef: {
                readonly type: "string";
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }, {
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
    }];
};
type CreateCollectionOutput = InferValue<typeof CREATE_COLLECTION_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function createCollectionPlan(args: CreateCollectionArgs): string;
export declare function renderCreateCollection(_args: CreateCollectionArgs, value: CreateCollectionOutput): ContentBlock[];
export declare function registerCreateCollectionTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=create-collection.d.ts.map