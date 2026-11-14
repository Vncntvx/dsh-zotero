/**
 * The `zotero_browse` tool: library discovery without assuming structure.
 * Model-facing bounded listing for libraries, collections, saved searches, tags, itemTypes.
 * All library resolution follows canonical SupportedLocalLibrary identity.
 * @module dsh-zotero/tools/browse
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import { type ToolWrapper } from '../result-delivery.js';
import type { ZoteroService } from '../service.js';
declare const BROWSE_PARAMETERS: {
    readonly kind: {
        readonly type: 'string';
        readonly enum: readonly ["libraries", "collections", "savedSearches", "tags", "itemTypes", "itemFields"];
        readonly required: true;
        readonly description: 'Browse libraries, collections, savedSearches, tags, itemTypes, itemFields (itemType required).';
    };
    readonly library: {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly properties: {
            readonly type: {
                readonly type: 'string';
                readonly enum: readonly ['user', 'group'];
                readonly required: true;
            };
            readonly id: {
                readonly type: 'integer';
                readonly required: true;
            };
        };
        readonly description: 'For collections/savedSearches/tags; defaults user/0. Invalid for libraries/itemTypes/itemFields.';
    };
    readonly parentRef: {
        readonly type: 'string';
        readonly description: 'Collections only: parent collection ref; omit for top-level collections.';
    };
    readonly tagScope: {
        readonly type: 'string';
        readonly enum: readonly ['library', 'collection', 'publications'];
        readonly description: 'Tags only: count scope (library, collection, or publications).';
    };
    readonly tagCollection: {
        readonly type: 'string';
        readonly description: 'Tags with collection scope: collection ref or exact name.';
    };
    readonly itemLevel: {
        readonly type: 'string';
        readonly enum: readonly ['top', 'all'];
        readonly default: 'top';
        readonly description: 'Tags only: top-level (default) or all items including children.';
    };
    readonly itemQuery: {
        readonly type: 'string';
        readonly description: 'Tags only: count tags on matching items.';
    };
    readonly itemQueryMode: {
        readonly type: 'string';
        readonly enum: readonly ['titleCreatorYear', 'everything'];
        readonly default: 'titleCreatorYear';
        readonly description: 'itemQuery mode: titleCreatorYear (default) or everything.';
    };
    readonly itemType: {
        readonly type: 'string';
        readonly description: 'itemFields only: Zotero item type, e.g. dataset.';
    };
    readonly q: {
        readonly type: 'string';
        readonly description: 'Substring filter; tags only.';
    };
    readonly match: {
        readonly type: 'string';
        readonly enum: readonly ['contains', 'startsWith'];
        readonly default: 'contains';
        readonly description: 'Tag q match: contains (default) or startsWith.';
    };
    readonly offset: {
        readonly type: 'integer';
        readonly default: 0;
        readonly description: 'Offset.';
    };
    readonly limit: {
        readonly type: 'integer';
        readonly default: 20;
        readonly description: 'Max rows; capped by maxBrowseResults.';
    };
};
type BrowseArgs = InferArgs<typeof BROWSE_PARAMETERS>;
declare const BROWSE_OUTPUT_SCHEMA: {
    readonly type: 'object';
    readonly additionalProperties: false;
    readonly properties: {
        readonly kind: {
            readonly type: 'string';
            readonly required: true;
        };
        readonly library: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly type: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly id: {
                    readonly type: 'integer';
                    readonly required: true;
                };
            };
        };
        readonly serverId: {
            readonly type: 'string';
        };
        readonly items: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly oneOf: readonly [{
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly library: {
                            readonly type: 'object';
                            readonly additionalProperties: false;
                            readonly properties: {
                                readonly type: {
                                    readonly type: 'string';
                                    readonly enum: readonly ['user', 'group'];
                                    readonly required: true;
                                };
                                readonly id: {
                                    readonly type: 'integer';
                                    readonly required: true;
                                };
                            };
                            readonly required: true;
                        };
                        readonly name: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly ref: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly name: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly parentRef: {
                            readonly type: 'string';
                        };
                        readonly path: {
                            readonly type: 'array';
                            readonly required: true;
                            readonly items: {
                                readonly type: 'string';
                            };
                        };
                        readonly depth: {
                            readonly type: 'integer';
                            readonly required: true;
                        };
                        readonly childCount: {
                            readonly type: 'integer';
                        };
                        readonly itemCount: {
                            readonly type: 'integer';
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly ref: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly name: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly conditions: {
                            readonly type: 'array';
                            readonly items: {
                                readonly type: 'object';
                                readonly additionalProperties: false;
                                readonly properties: {
                                    readonly condition: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                    readonly operator: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                    readonly value: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                };
                            };
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly tag: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly count: {
                            readonly type: 'integer';
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly itemType: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly localized: {
                            readonly type: 'string';
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly field: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly localized: {
                            readonly type: 'string';
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly creatorType: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly localized: {
                            readonly type: 'string';
                        };
                    };
                }];
            };
        };
        readonly total: {
            readonly type: 'integer';
            readonly required: true;
        };
        readonly offset: {
            readonly type: 'integer';
            readonly required: true;
        };
        readonly returned: {
            readonly type: 'integer';
            readonly required: true;
        };
        readonly libraryVersion: {
            readonly type: 'integer';
        };
        readonly nextOffset: {
            readonly type: 'integer';
        };
        readonly maximum: {
            readonly type: 'integer';
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
export declare function registerBrowseTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): void;
export {};
//# sourceMappingURL=browse.d.ts.map