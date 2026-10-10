/**
 * The `zotero_retrieve` tool: gather evidence passages for one item and
 * rank them against a query. Annotations, notes, the abstract, and
 * full-text chunks compete in one BM25-ranked passage corpus; the result
 * is capped by passage count and character budget with a `truncated` flag
 * instead of mid-passage edits. Full-text passages never carry invented
 * page locators; only annotations keep Zotero's own page label.
 * @module dsh-zotero/tools/retrieve
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const RETRIEVE_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY> ref from zotero_search or zotero_get.";
    };
    readonly query: {
        readonly type: "string";
        readonly required: true;
        readonly description: "Terms the evidence passages are ranked against.";
    };
    readonly sources: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
            readonly enum: readonly ["annotation", "note", "abstract", "fulltext"];
        };
        readonly default: import("../evidence-item.js").EvidenceSource[];
        readonly description: "Evidence sources to gather; defaults to all four. Sources the item cannot provide are skipped and reported in sourcesSkipped, not an error.";
    };
    readonly passages: {
        readonly type: "integer";
        readonly default: 4;
        readonly description: "Maximum ranked evidence passages to return; capped by the configured maxEvidencePassages.";
    };
    readonly attachmentPolicy: {
        readonly type: "string";
        readonly enum: readonly ["best", "allIndexed", "specified"];
        readonly description: "How full text is sourced when requested. best (default) uses Zotero's single chosen PDF; allIndexed ranks every PDF child (publisher copy, manuscript, supplement); specified ranks exactly the attachmentRefs.";
    };
    readonly attachmentRefs: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Required with attachmentPolicy=\"specified\": zotero://.../attachment/<KEY> refs of the same library whose full text enters ranking. Each must be an attachment of ref (a child of that item) on the same Zotero instance; anything else fails the call. Repeats are read once; the number entering one call is capped by the configured retrieveAttachmentCap.";
    };
};
type RetrieveArgs = InferArgs<typeof RETRIEVE_PARAMETERS>;
declare const RETRIEVE_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ref: {
            readonly type: "string";
            readonly required: true;
        };
        readonly attachmentRef: {
            readonly type: "string";
        };
        readonly attachmentContentType: {
            readonly type: "string";
        };
        readonly coverage: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly indexedPages: {
                    readonly type: "integer";
                };
                readonly totalPages: {
                    readonly type: "integer";
                };
                readonly indexedChars: {
                    readonly type: "integer";
                };
                readonly totalChars: {
                    readonly type: "integer";
                };
                readonly complete: {
                    readonly type: "boolean";
                    readonly required: true;
                };
            };
        };
        readonly attachments: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly ref: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly contentType: {
                        readonly type: "string";
                    };
                    readonly status: {
                        readonly type: "string";
                        readonly enum: readonly ["indexed", "unindexed", "unread"];
                        readonly required: true;
                    };
                    readonly coverage: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly indexedPages: {
                                readonly type: "integer";
                            };
                            readonly totalPages: {
                                readonly type: "integer";
                            };
                            readonly indexedChars: {
                                readonly type: "integer";
                            };
                            readonly totalChars: {
                                readonly type: "integer";
                            };
                            readonly complete: {
                                readonly type: "boolean";
                                readonly required: true;
                            };
                        };
                    };
                    readonly inputTruncated: {
                        readonly type: "boolean";
                    };
                    readonly passages: {
                        readonly type: "integer";
                    };
                };
            };
        };
        readonly evidence: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly source: {
                        readonly type: "string";
                        readonly enum: import("../evidence-item.js").EvidenceSource[];
                        readonly required: true;
                    };
                    readonly sourceRef: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly text: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly chunkIndex: {
                        readonly type: "integer";
                    };
                    readonly chunkCount: {
                        readonly type: "integer";
                    };
                    readonly comment: {
                        readonly type: "string";
                    };
                    readonly pageLabel: {
                        readonly type: "string";
                    };
                    readonly attachmentRef: {
                        readonly type: "string";
                    };
                    readonly matchedFields: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                            readonly enum: readonly ["text", "comment"];
                        };
                    };
                };
            };
        };
        readonly truncated: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly sourcesSkipped: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly type: "string";
                readonly enum: readonly ["annotation", "note", "abstract", "fulltext"];
            };
        };
    };
};
type RetrieveOutput = InferValue<typeof RETRIEVE_OUTPUT_SCHEMA>;
/** The model-facing messages the retrieve argument rules throw. */
export declare const RETRIEVE_QUERY_EMPTY_MESSAGE = "query must be a non-empty string of terms to rank evidence against";
export declare const RETRIEVE_SOURCES_EMPTY_MESSAGE = "sources must list at least one evidence source";
export declare const RETRIEVE_SPECIFIED_EMPTY_MESSAGE = "attachmentPolicy \"specified\" requires at least one attachmentRef";
export declare const RETRIEVE_SPECIFIED_ONLY_MESSAGE = "attachmentRefs is only valid with attachmentPolicy=\"specified\"";
/**
 * The message for an attachmentRef outside the item's own library: the ref's
 * library is named so the model can see which identity the list must match.
 */
export declare function attachmentRefsLibraryMessage(library: string): string;
/**
 * The message for a list of distinct attachmentRefs past the per-call cap.
 * The count names how much work the call asked for and the cap names the
 * split point.
 */
export declare function attachmentRefsOverCapMessage(count: number, cap: number): string;
/**
 * The clause appended to a match line whose only hit is a reader comment:
 * those words are the annotator's, not the paper's.
 */
export declare const PASSAGE_COMMENT_ONLY_CLAUSE = "those are the annotator\u2019s words, not the paper\u2019s own text";
/** The model-facing note for an attachment Zotero has not indexed. */
export declare const ATTACHMENT_UNINDEXED_NOTE = "no full text in Zotero's index";
/** The model-facing note for an attachment this call's cap left unread. */
export declare const ATTACHMENT_LIMIT_NOTE = "not read: this call was already at its attachment limit";
/**
 * The honesty line under the full-text sources: how many of them contributed
 * no text, so whatever they contain is not covered.
 */
export declare function silentAttachmentsMessage(silent: number, total: number): string;
/**
 * The truncated-result message: what was omitted, what a passage costs, and
 * the call that reads the item's notes and annotations outside the budget.
 */
export declare const RETRIEVE_TRUNCATED_MESSAGE = "More evidence was available but omitted by the passage or character budget: a passage charges its text and, for an annotation, its comment.";
/** The remedy half of {@link RETRIEVE_TRUNCATED_MESSAGE}. */
export declare const RETRIEVE_TRUNCATED_REMEDY = "zotero_get with include:[\"notes\", \"annotations\"] reads the item\u2019s notes and annotations outside this budget.";
export declare function renderRetrieve(_args: RetrieveArgs, value: RetrieveOutput): ContentBlock[];
/**
 * Register the `zotero_retrieve` tool. The service's live config is read per
 * request so a settings edit takes effect on the next call without
 * re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export declare function registerRetrieveTool(ctx: Context, service: ZoteroService): void;
export {};
//# sourceMappingURL=retrieve.d.ts.map