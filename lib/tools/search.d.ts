/**
 * The `zotero_search` tool: discover candidates in the user's library with
 * Zotero's own quick search. Output stays compact (refs, titles, creators,
 * years, and Zotero's best-attachment hint), so the Agent can escalate to
 * `zotero_get`/`zotero_retrieve` with stable refs.
 * @module dsh-zotero/tools/search
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const SEARCH_PARAMETERS: {
    readonly query: {
        readonly type: "string";
        readonly description: "Free-text query; omit to browse the scope unfiltered.";
    };
    readonly mode: {
        readonly type: "string";
        readonly enum: readonly ["metadata", "everything"];
        readonly default: "metadata";
        readonly description: "metadata: title/creator/year only; everything: also indexed full text.";
    };
    readonly scope: {
        readonly oneOf: readonly [{
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: "string";
                    readonly const: "library";
                    readonly required: true;
                };
            };
        }, {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: "string";
                    readonly const: "publications";
                    readonly required: true;
                };
            };
        }, {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: "string";
                    readonly const: "collection";
                    readonly required: true;
                };
                readonly refOrName: {
                    readonly type: "string";
                    readonly required: true;
                    readonly description: "Collection name or zotero://user/0/collection/<KEY> or zotero://group/<id>/collection/<KEY> ref.";
                };
            };
        }, {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: "string";
                    readonly const: "savedSearch";
                    readonly required: true;
                };
                readonly refOrName: {
                    readonly type: "string";
                    readonly required: true;
                    readonly description: "Saved search name or zotero://user/0/search/<KEY> ref or zotero://group/<id>/search/<KEY> ref.";
                };
            };
        }];
        readonly default: {
            readonly kind: "library";
        };
        readonly description: "Where to search. Defaults to the whole library; publications searches My Publications.";
    };
    readonly library: {
        readonly description: "Library to search (personal user/0 or group/<id>); omit defaults to user/0. For collection/savedSearch by name, this chooses the library; for ref scopes must match the ref.";
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
    };
    readonly itemTypes: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Zotero item type names (e.g. journalArticle), combined with OR.";
    };
    readonly tags: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Literal tag names; items must have ALL of them (tagMatch controls ANY).";
    };
    readonly tagMatch: {
        readonly type: "string";
        readonly enum: readonly ["all", "any"];
        readonly description: "How multiple tags combine: all=AND (default), any=OR.";
    };
    readonly excludeTags: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Literal tag names to exclude (NOT).";
    };
    readonly includeTrashed: {
        readonly type: "boolean";
        readonly description: "Include trashed items (only with library scope); default false.";
    };
    readonly itemLevel: {
        readonly type: "string";
        readonly enum: readonly ["top", "all"];
        readonly default: "top";
        readonly description: "top searches only top-level bibliographic items (default); all searches both top-level items and child notes/attachments.";
    };
    readonly sort: {
        readonly type: "string";
        readonly enum: readonly import("../types.js").ZoteroSortField[];
        readonly default: "dateModified";
        readonly description: "Result order field.";
    };
    readonly direction: {
        readonly type: "string";
        readonly enum: readonly ["asc", "desc"];
        readonly default: "desc";
        readonly description: "Result order direction.";
    };
    readonly offset: {
        readonly type: "integer";
        readonly default: 0;
        readonly description: "Pagination offset for exploring more results.";
    };
    readonly limit: {
        readonly type: "integer";
        readonly default: 10;
        readonly description: "Maximum results to return; capped by the configured maxSearchResults.";
    };
};
type SearchArgs = InferArgs<typeof SEARCH_PARAMETERS>;
declare const SEARCH_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly scope: {
            readonly required: true;
            readonly oneOf: readonly [{
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "library";
                        readonly required: true;
                    };
                    readonly library: {
                        readonly type: "object";
                        readonly required: true;
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly type: {
                                readonly type: "string";
                                readonly const: "user";
                                readonly required: true;
                            };
                            readonly id: {
                                readonly type: "integer";
                                readonly const: 0;
                                readonly required: true;
                            };
                        };
                    };
                };
            }, {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "library";
                        readonly required: true;
                    };
                    readonly library: {
                        readonly type: "object";
                        readonly required: true;
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly type: {
                                readonly type: "string";
                                readonly const: "group";
                                readonly required: true;
                            };
                            readonly id: {
                                readonly type: "integer";
                                readonly required: true;
                            };
                        };
                    };
                };
            }, {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "publications";
                        readonly required: true;
                    };
                    readonly library: {
                        readonly type: "object";
                        readonly required: true;
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly type: {
                                readonly type: "string";
                                readonly const: "user";
                                readonly required: true;
                            };
                            readonly id: {
                                readonly type: "integer";
                                readonly const: 0;
                                readonly required: true;
                            };
                        };
                    };
                };
            }, {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "collection";
                        readonly required: true;
                    };
                    readonly ref: {
                        readonly type: "string";
                        readonly required: true;
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
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "savedSearch";
                        readonly required: true;
                    };
                    readonly ref: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly name: {
                        readonly type: "string";
                        readonly required: true;
                    };
                };
            }];
        };
        readonly items: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly ref: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly title: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly creatorSummary: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly year: {
                        readonly type: "integer";
                    };
                    readonly itemType: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly parentRef: {
                        readonly type: "string";
                    };
                    readonly bestAttachmentRef: {
                        readonly type: "string";
                    };
                    readonly bestAttachmentType: {
                        readonly type: "string";
                    };
                    readonly attachmentSize: {
                        readonly type: "integer";
                    };
                    readonly extra: {
                        readonly type: "string";
                    };
                };
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
        readonly supplemental: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: "string";
                    readonly const: "noteBody";
                    readonly required: true;
                };
                readonly items: {
                    readonly type: "array";
                    readonly required: true;
                    readonly items: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly ref: {
                                readonly type: "string";
                                readonly required: true;
                            };
                            readonly title: {
                                readonly type: "string";
                                readonly required: true;
                            };
                            readonly creatorSummary: {
                                readonly type: "string";
                                readonly required: true;
                            };
                            readonly year: {
                                readonly type: "integer";
                            };
                            readonly itemType: {
                                readonly type: "string";
                                readonly required: true;
                            };
                            readonly parentRef: {
                                readonly type: "string";
                            };
                            readonly bestAttachmentRef: {
                                readonly type: "string";
                            };
                            readonly bestAttachmentType: {
                                readonly type: "string";
                            };
                            readonly attachmentSize: {
                                readonly type: "integer";
                            };
                            readonly extra: {
                                readonly type: "string";
                            };
                        };
                    };
                };
                readonly scanned: {
                    readonly type: "integer";
                    readonly required: true;
                };
                readonly truncated: {
                    readonly type: "boolean";
                    readonly required: true;
                };
            };
        };
    };
};
type SearchOutput = InferValue<typeof SEARCH_OUTPUT_SCHEMA>;
/** The model-facing messages the search argument rules throw. */
export declare const SCOPE_REF_OR_NAME_MESSAGE = "scope.refOrName must be a collection/saved-search name or ref";
export declare const TAGS_LITERAL_MESSAGE = "tags are literal tag names (AND semantics); got an empty or \"||\"-containing tag";
export declare const EXCLUDE_TAGS_LITERAL_MESSAGE = "excludeTags are literal tag names";
export declare const TAG_MATCH_REQUIRES_TAGS_MESSAGE = "tagMatch requires tags; it has no effect without a tag filter";
export declare const INCLUDE_TRASHED_SCOPE_MESSAGE = "includeTrashed is only allowed with library scope";
export declare const ITEM_TYPES_LITERAL_MESSAGE = "itemTypes are positive Zotero item type names joined with OR";
/** The page announcement: where the next page starts, and that the scope stays. */
export declare function searchMoreMessage(nextOffset: number): string;
/** The supplemental announcement: note-body matches sit outside the paged total. */
export declare function noteBodyMatchesMessage(count: number, scanned: number, truncated: boolean): string;
export declare function renderSearch(_args: SearchArgs, value: SearchOutput): ContentBlock[];
/**
 * Register the `zotero_search` tool. The service's live config is read per
 * request so a settings edit takes effect on the next call without
 * re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export declare function registerSearchTool(ctx: Context, service: ZoteroService): void;
export {};
//# sourceMappingURL=search.d.ts.map