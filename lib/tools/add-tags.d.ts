/**
 * The `zotero_add_tags` tool: add tags to one Zotero item. The domain runs
 * read-merge-write under a version precondition, preserving the tags and tag
 * types the item already carries; an all-already-present call writes nothing
 * and reports unchanged. The plan-review approval runs before Zotero is
 * contacted.
 * @module dsh-zotero/tools/add-tags
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const ADD_TAGS_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref to tag.";
    };
    readonly tags: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly required: true;
        readonly description: "Tags to add. They merge with the item's existing tags — what is already there stays, including its colored/automatic types; duplicates collapse.";
    };
};
type AddTagsArgs = InferArgs<typeof ADD_TAGS_PARAMETERS>;
declare const ADD_TAGS_OUTPUT_SCHEMA: {
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
type AddTagsOutput = InferValue<typeof ADD_TAGS_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function addTagsPlan(args: AddTagsArgs): string;
export declare function renderAddTags(_args: AddTagsArgs, value: AddTagsOutput): ContentBlock[];
export declare function registerAddTagsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=add-tags.d.ts.map