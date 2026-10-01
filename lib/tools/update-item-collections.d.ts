/**
 * The `zotero_update_item_collections` tool: update one item's collection
 * membership with add and remove settling in a single read-merge-write.
 * Collections are named by ref or exact name; unknown or ambiguous names fail
 * before any write. The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/update-item-collections
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const UPDATE_ITEM_COLLECTIONS_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref whose membership changes.";
    };
    readonly add: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Collections to join: zotero://user/0/collection/<KEY> refs or exact names (zotero_browse lists them).";
    };
    readonly remove: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Collections to leave: zotero://user/0/collection/<KEY> refs or exact names.";
    };
};
type UpdateItemCollectionsArgs = InferArgs<typeof UPDATE_ITEM_COLLECTIONS_PARAMETERS>;
declare const UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA: {
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
                readonly description: "The item's version after the update (or the read version when unchanged).";
            };
            readonly collections: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly added: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly removed: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly unchanged: {
                readonly type: "boolean";
                readonly required: true;
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly description: "The library version the write advanced to; absent when unchanged.";
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }];
};
type UpdateItemCollectionsOutput = InferValue<typeof UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function updateItemCollectionsPlan(args: UpdateItemCollectionsArgs): string;
export declare function renderUpdateItemCollections(_args: UpdateItemCollectionsArgs, value: UpdateItemCollectionsOutput): ContentBlock[];
export declare function registerUpdateItemCollectionsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-item-collections.d.ts.map