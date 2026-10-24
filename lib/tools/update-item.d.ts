/**
 * The `zotero_update_item` tool: update one item's scalar metadata fields.
 * Every field must belong to the closed set and be valid for the item's own
 * type (checked against `itemTypeFields`); the PATCH carries wire names under
 * a version precondition. `creators`, `itemType`, `tags`, and `collections`
 * have their own tools and never enter here.
 * @module dsh-zotero/tools/update-item
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const UPDATE_ITEM_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> ref whose metadata changes.";
    };
    readonly set: {
        readonly type: "object";
        readonly required: true;
        readonly additionalProperties: false;
        readonly properties: {
            readonly title: {
                readonly type: "string";
            };
            readonly date: {
                readonly type: "string";
            };
            readonly url: {
                readonly type: "string";
            };
            readonly doi: {
                readonly type: "string";
            };
            readonly abstractNote: {
                readonly type: "string";
            };
            readonly publicationTitle: {
                readonly type: "string";
            };
            readonly extra: {
                readonly type: "string";
            };
        };
        readonly description: "Field updates (at least one): title, date, url, doi, abstractNote, publicationTitle, extra. Each value must be non-blank text and valid for the item type.";
    };
};
type UpdateItemArgs = InferArgs<typeof UPDATE_ITEM_PARAMETERS>;
declare const UPDATE_ITEM_OUTPUT_SCHEMA: {
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
            };
            readonly changed: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly required: true;
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }];
};
type UpdateItemOutput = InferValue<typeof UPDATE_ITEM_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function updateItemPlan(args: UpdateItemArgs): string;
export declare function renderUpdateItem(_args: UpdateItemArgs, value: UpdateItemOutput): ContentBlock[];
export declare function registerUpdateItemTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=update-item.d.ts.map