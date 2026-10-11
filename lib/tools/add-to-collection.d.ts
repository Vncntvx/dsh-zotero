/**
 * The `zotero_add_to_collection` tool: add one Zotero item to a collection,
 * by ref or by name. The plan-review approval runs before Zotero is contacted,
 * so a declined plan contacts nothing; after approval the domain validates the
 * collection and runs read-merge-write under a version precondition, where an
 * already-member item writes nothing and reports added: false.
 * @module dsh-zotero/tools/add-to-collection
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const ADD_TO_COLLECTION_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref to add.";
    };
    readonly collection: {
        readonly type: "string";
        readonly required: true;
        readonly description: "The collection to add the item to: a zotero://user/0/collection/<KEY> ref or an exact collection name (zotero_browse lists them). An unknown name fails before any write.";
    };
};
type AddToCollectionArgs = InferArgs<typeof ADD_TO_COLLECTION_PARAMETERS>;
declare const ADD_TO_COLLECTION_OUTPUT_SCHEMA: {
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
            readonly version: {
                readonly type: "integer";
                readonly required: true;
                readonly description: "The item's version after the update.";
            };
            readonly collections: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly added: {
                readonly type: "boolean";
                readonly required: true;
                readonly description: "True when the item was newly added; false when it was already a member.";
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly description: "The library version the write advanced to; absent when already a member.";
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }];
};
type AddToCollectionOutput = InferValue<typeof ADD_TO_COLLECTION_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function addToCollectionPlan(args: AddToCollectionArgs): string;
export declare function renderAddToCollection(_args: AddToCollectionArgs, value: AddToCollectionOutput): ContentBlock[];
export declare function registerAddToCollectionTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=add-to-collection.d.ts.map