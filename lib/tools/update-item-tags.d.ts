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
import { UPDATE_ITEM_TAGS_OUTPUT_SCHEMA } from './write-present.js';
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
        readonly description: "Tags to add. They merge with the item's existing tags: what is already there stays, including its colored/automatic types; duplicates collapse.";
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
type UpdateItemTagsOutput = InferValue<typeof UPDATE_ITEM_TAGS_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function updateItemTagsPlan(args: UpdateItemTagsArgs): string;
export declare function renderUpdateItemTags(_args: UpdateItemTagsArgs, value: UpdateItemTagsOutput): ContentBlock[];
export declare function registerUpdateItemTagsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-item-tags.d.ts.map