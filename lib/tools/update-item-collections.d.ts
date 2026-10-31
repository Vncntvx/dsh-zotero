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
import { UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA } from './write-present.js';
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
type UpdateItemCollectionsOutput = InferValue<typeof UPDATE_ITEM_COLLECTIONS_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function updateItemCollectionsPlan(args: UpdateItemCollectionsArgs): string;
export declare function renderUpdateItemCollections(_args: UpdateItemCollectionsArgs, value: UpdateItemCollectionsOutput): ContentBlock[];
export declare function registerUpdateItemCollectionsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-item-collections.d.ts.map