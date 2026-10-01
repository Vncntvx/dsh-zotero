/**
 * The `zotero_update_item_tags` tool: update one item's tags with add and
 * remove settling in a single read-merge-write. Existing tag types are
 * preserved; an unchanged merge writes nothing and reports `unchanged`.
 * The plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/update-item-tags
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const UPDATE_ITEM_TAGS_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref whose tags change.";
    };
    readonly add: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Tags to add. They merge with the item's existing tags — what is already there stays, including its colored/automatic types; duplicates collapse.";
    };
    readonly remove: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Tags to remove, matched exactly. Unknown names are ignored.";
    };
};
type UpdateItemTagsArgs = InferArgs<typeof UPDATE_ITEM_TAGS_PARAMETERS>;
declare const UPDATE_ITEM_TAGS_OUTPUT_SCHEMA: {
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
            readonly tags: {
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
type UpdateItemTagsOutput = InferValue<typeof UPDATE_ITEM_TAGS_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function updateItemTagsPlan(args: UpdateItemTagsArgs): string;
export declare function renderUpdateItemTags(_args: UpdateItemTagsArgs, value: UpdateItemTagsOutput): ContentBlock[];
export declare function registerUpdateItemTagsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-item-tags.d.ts.map