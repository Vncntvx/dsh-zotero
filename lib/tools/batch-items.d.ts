/**
 * The `zotero_batch_items` tool: execute batch item operations (create/import,
 * update tags/collections, delete) in a single reviewed plan card.
 * Previews blast radius for deletes before approval; executes creates via
 * native POST batch and updates/deletes sequentially under version preconditions.
 * @module dsh-zotero/tools/batch-items
 */
import type { Context } from '@deepseek-ai/cordis';
import { type InferArgs } from '@deepseek-ai/dsh-tools';
import type { ResolvedConfig } from '../config.js';
import type { ZoteroService } from '../service.js';
import type { ZoteroBatchItemsRequest } from '../types.js';
declare const BATCH_ITEMS_PARAMETERS: {
    readonly create: {
        readonly type: "array";
        readonly description: "Items to create or import into the personal library.";
        readonly items: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly itemType: {
                    readonly type: "string";
                    readonly required: true;
                    readonly description: "The Zotero item type: webpage, journalArticle, book, conferencePaper, report, thesis, document, or preprint.";
                };
                readonly title: {
                    readonly type: "string";
                    readonly description: "Item title. At least title or url is required.";
                };
                readonly url: {
                    readonly type: "string";
                    readonly description: "Item URL. At least title or url is required.";
                };
                readonly date: {
                    readonly type: "string";
                    readonly description: "Publication date.";
                };
                readonly doi: {
                    readonly type: "string";
                    readonly description: "DOI.";
                };
                readonly abstractNote: {
                    readonly type: "string";
                    readonly description: "Abstract.";
                };
                readonly publicationTitle: {
                    readonly type: "string";
                    readonly description: "Venue or journal title.";
                };
                readonly creators: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly creatorType: {
                                readonly type: "string";
                                readonly required: true;
                            };
                            readonly name: {
                                readonly type: "string";
                            };
                            readonly firstName: {
                                readonly type: "string";
                            };
                            readonly lastName: {
                                readonly type: "string";
                            };
                        };
                    };
                    readonly description: "Creators.";
                };
                readonly tags: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                    readonly description: "Tags to attach on creation.";
                };
                readonly collections: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                    readonly description: "Collections to add the new item to (refs or exact names).";
                };
            };
        };
    };
    readonly update: {
        readonly type: "array";
        readonly description: "Existing items whose tags or collection memberships should be updated.";
        readonly items: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly ref: {
                    readonly type: "string";
                    readonly required: true;
                    readonly description: "A zotero://user/0/item/<KEY> ref whose tags or collections change.";
                };
                readonly addTags: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                    readonly description: "Tags to add.";
                };
                readonly removeTags: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                    readonly description: "Tags to remove.";
                };
                readonly addCollections: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                    readonly description: "Collections to add (refs or exact names).";
                };
                readonly removeCollections: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                    readonly description: "Collections to remove (refs or exact names).";
                };
            };
        };
    };
    readonly delete: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Refs of items to delete (move to Trash). Each must be a zotero://user/0/item/<KEY> ref.";
    };
};
type BatchItemsArgs = InferArgs<typeof BATCH_ITEMS_PARAMETERS>;
export interface DeleteItemPreview {
    readonly ref: string;
    readonly title?: string;
    readonly childCount?: number;
}
/**
 * The deterministic plan markdown the approval card renders.
 *
 * Kept to the Markdown subset the host renders: its plan view escapes raw
 * HTML to literal text, so a `<details>` collapse would show up as tags
 * rather than a fold. Folding is the host's job — the conversation card shows
 * the first line and first paragraph, the sidebar shows the whole document.
 * @param args - the requested operations.
 * @param deletePreviews - the read-back preview for each deletion target.
 * @returns the plan markdown.
 */
export declare function batchItemsPlan(args: BatchItemsArgs, deletePreviews?: readonly DeleteItemPreview[]): string;
export declare function buildBatchItemsRequest(args: BatchItemsArgs, config: ResolvedConfig): ZoteroBatchItemsRequest;
export declare function previewBatchItems(service: ZoteroService, deletes: readonly string[] | undefined, signal: AbortSignal | undefined): Promise<DeleteItemPreview[]>;
export declare function registerBatchItemsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=batch-items.d.ts.map