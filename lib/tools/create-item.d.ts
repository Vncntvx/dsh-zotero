/**
 * The `zotero_create_item` tool: create a bibliographic item from the closed
 * field set. No BibTeX/CSL-JSON channel exists: `POST /items` only accepts
 * Zotero item JSON, so the entry is assembled field by field. The
 * plan-review approval runs before Zotero is contacted.
 * @module dsh-zotero/tools/create-item
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const CREATE_ITEM_PARAMETERS: {
    readonly itemType: {
        readonly type: "string";
        readonly required: true;
        readonly description: "The Zotero item type: webpage, journalArticle, book, conferencePaper, report, thesis, document, or preprint.";
    };
    readonly title: {
        readonly type: "string";
        readonly description: "The item title. At least a title or a URL is required.";
    };
    readonly url: {
        readonly type: "string";
        readonly description: "The item URL. At least a title or a URL is required.";
    };
    readonly date: {
        readonly type: "string";
        readonly description: "The publication date, as Zotero stores it.";
    };
    readonly doi: {
        readonly type: "string";
        readonly description: "The DOI (stored as DOI).";
    };
    readonly abstractNote: {
        readonly type: "string";
        readonly description: "The abstract.";
    };
    readonly publicationTitle: {
        readonly type: "string";
        readonly description: "The venue (journal, proceedings, site).";
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
        readonly description: "Creators, each with a creatorType and either a name or a firstName/lastName pair.";
    };
};
type CreateItemArgs = InferArgs<typeof CREATE_ITEM_PARAMETERS>;
declare const CREATE_ITEM_OUTPUT_SCHEMA: {
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
            readonly itemType: {
                readonly type: "string";
                readonly required: true;
            };
            readonly title: {
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
type CreateItemOutput = InferValue<typeof CREATE_ITEM_OUTPUT_SCHEMA>;
/** The deterministic plan markdown the approval card renders. */
export declare function createItemPlan(args: CreateItemArgs): string;
export declare function renderCreateItem(_args: CreateItemArgs, value: CreateItemOutput): ContentBlock[];
export declare function registerCreateItemTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=create-item.d.ts.map