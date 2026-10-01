/**
 * The `zotero_browse` tool: library discovery without assuming structure.
 * Model-facing bounded listing for libraries, collections, saved searches, tags, itemTypes.
 * All library resolution follows canonical SupportedLocalLibrary identity.
 * @module dsh-zotero/tools/browse
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const BROWSE_PARAMETERS: {
    readonly kind: {
        readonly type: "string";
        readonly enum: readonly ["libraries", "collections", "savedSearches", "tags", "itemTypes", "itemFields"];
        readonly required: true;
        readonly description: "What to browse: libraries, collections, savedSearches, tags, itemTypes, itemFields (itemFields requires itemType)";
    };
    readonly library: {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly type: {
                readonly type: "string";
                readonly enum: readonly ["user", "group"];
                readonly required: true;
            };
            readonly id: {
                readonly type: "integer";
                readonly required: true;
            };
        };
        readonly description: "Library for collections/savedSearches/tags; omitted defaults to personal user/0. Not allowed for libraries/itemTypes/itemFields (fail-closed).";
    };
    readonly parentRef: {
        readonly type: "string";
        readonly description: "Collections only: a zotero://.../collection/<KEY> ref whose children to list. Omit to list top-level collections.";
    };
    readonly tagScope: {
        readonly type: "string";
        readonly enum: readonly ["library", "collection", "publications"];
        readonly description: "Tags only: count tags over this item set. Omit for the whole-library tag list; collection/publications use the scoped tag endpoints.";
    };
    readonly tagCollection: {
        readonly type: "string";
        readonly description: "Tags only with tagScope=\"collection\": a collection ref or exact name whose items the tag counts describe.";
    };
    readonly itemLevel: {
        readonly type: "string";
        readonly enum: readonly ["top", "all"];
        readonly description: "Tags only with a scope: top counts bibliographic items (default), all includes child items.";
    };
    readonly itemQuery: {
        readonly type: "string";
        readonly description: "Tags only with a scope: count only tags of items matching this query — the facet-discovery move after a search.";
    };
    readonly itemQueryMode: {
        readonly type: "string";
        readonly enum: readonly ["titleCreatorYear", "everything"];
        readonly description: "Tags only with itemQuery: the Zotero item-query mode (titleCreatorYear or everything; default titleCreatorYear).";
    };
    readonly itemType: {
        readonly type: "string";
        readonly description: "ItemFields only: the Zotero item type whose valid fields and creator types to list (e.g. dataset, patent).";
    };
    readonly q: {
        readonly type: "string";
        readonly description: "Filter for tags kind (substring); only valid when kind=\"tags\"";
    };
    readonly match: {
        readonly type: "string";
        readonly enum: readonly ["contains", "startsWith"];
        readonly description: "How q matches tags; only valid when kind=\"tags\"; default contains";
    };
    readonly offset: {
        readonly type: "integer";
        readonly default: 0;
        readonly description: "Pagination offset";
    };
    readonly limit: {
        readonly type: "integer";
        readonly default: 20;
        readonly description: "Max items to return; capped by maxBrowseResults";
    };
};
type BrowseArgs = InferArgs<typeof BROWSE_PARAMETERS>;
declare const BROWSE_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly kind: {
            readonly type: "string";
            readonly required: true;
        };
        readonly library: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly type: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly id: {
                    readonly type: "integer";
                    readonly required: true;
                };
            };
        };
        readonly serverId: {
            readonly type: "string";
        };
        readonly items: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly oneOf: readonly [{
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly library: {
                            readonly type: "object";
                            readonly required: true;
                            readonly additionalProperties: false;
                            readonly properties: {
                                readonly type: {
                                    readonly type: "string";
                                    readonly enum: readonly ["user", "group"];
                                    readonly required: true;
                                };
                                readonly id: {
                                    readonly type: "integer";
                                    readonly required: true;
                                };
                            };
                        };
                        readonly name: {
                            readonly type: "string";
                            readonly required: true;
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly ref: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly name: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly parentRef: {
                            readonly type: "string";
                        };
                        readonly path: {
                            readonly type: "array";
                            readonly required: true;
                            readonly items: {
                                readonly type: "string";
                            };
                        };
                        readonly depth: {
                            readonly type: "integer";
                            readonly required: true;
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly ref: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly name: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly conditions: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "object";
                                readonly additionalProperties: true;
                            };
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly tag: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly count: {
                            readonly type: "integer";
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly itemType: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly localized: {
                            readonly type: "string";
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly field: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly localized: {
                            readonly type: "string";
                        };
                    };
                }, {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly creatorType: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly localized: {
                            readonly type: "string";
                        };
                    };
                }];
            };
        };
        readonly total: {
            readonly type: "integer";
            readonly required: true;
        };
        readonly offset: {
            readonly type: "integer";
            readonly required: true;
        };
        readonly returned: {
            readonly type: "integer";
            readonly required: true;
        };
        readonly nextOffset: {
            readonly type: "integer";
        };
    };
};
type BrowseOutput = InferValue<typeof BROWSE_OUTPUT_SCHEMA>;
/**
 * The tag-facet messages are this layer's own wording: they name the
 * model-facing arguments (`tagScope`), while the domain's counterpart names
 * the request field it validates (`SCOPE_FACET_KIND_MESSAGE`, `scope`).
 */
export declare const TAG_FACET_SCOPE_MESSAGE = "tagScope/itemLevel/itemQuery are only valid when kind=\"tags\"";
export declare const TAG_COLLECTION_SCOPE_MESSAGE = "tagCollection requires tagScope=\"collection\"";
export declare const TAG_SCOPE_COLLECTION_MESSAGE = "tagScope=\"collection\" requires tagCollection (a zotero:// ref or a collection name)";
export declare const ITEM_LEVEL_SCOPE_MESSAGE = "itemLevel/itemQuery require tagScope (library, collection, or publications)";
export declare const ITEM_QUERY_MODE_MESSAGE = "itemQueryMode requires itemQuery";
/** The page announcement: the offset the next call should pass. */
export declare function browseMoreMessage(nextOffset: number): string;
/**
 * The browse listing the model reads. The header states the page and the
 * total, each row follows `browseRowOf`'s classification, and a further page
 * closes with the offset to pass back. Row wording is this function's own;
 * which row is which is `browse-rows.ts`'s, shared with the Chat card.
 */
export declare function renderBrowse(_args: BrowseArgs, value: BrowseOutput): ContentBlock[];
export declare function registerBrowseTool(ctx: Context, service: ZoteroService): void;
export {};
//# sourceMappingURL=browse.d.ts.map