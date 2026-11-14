/**
 * The `zotero_retrieve` tool: gather evidence passages for one item and
 * rank them against a query. Annotations, notes, the abstract, and
 * full-text chunks compete in one ranked passage corpus; each passage reports
 * why it was returned (`matchKind`) so a meaning-level hit is never presented
 * as wording the source contains. The result is capped by passage count and
 * character budget with a `truncated` flag instead of mid-passage edits.
 * Full-text passages never carry invented page locators; only annotations keep
 * Zotero's own page label.
 * @module dsh-zotero/tools/retrieve
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import { type ToolWrapper } from '../result-delivery.js';
import type { ZoteroService } from '../service.js';
declare const RETRIEVE_PARAMETERS: {
    readonly ref: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY> ref from zotero_search or zotero_get.";
    };
    readonly query: {
        readonly type: 'string';
        readonly required: true;
        readonly description: 'Terms the evidence passages are ranked against.';
    };
    readonly queryVariants: {
        readonly type: 'array';
        readonly items: {
            readonly type: 'string';
        };
        readonly description: "Extra phrasings of the same question (synonyms, field terminology), at most 4; each is a separate scoring pass, and the best score per passage wins.";
    };
    readonly sources: {
        readonly type: 'array';
        readonly items: {
            readonly type: 'string';
            readonly enum: readonly ['annotation', 'note', 'abstract', 'fulltext'];
        };
        readonly default: import("../evidence-item.js").EvidenceSource[];
        readonly description: 'Sources to gather (default all); unavailable sources appear in sourcesSkipped.';
    };
    readonly passages: {
        readonly type: 'integer';
        readonly default: 4;
        readonly description: 'Passage cap, bounded by maxEvidencePassages.';
    };
    readonly attachmentPolicy: {
        readonly type: 'string';
        readonly enum: readonly ['best', 'allIndexed', 'specified'];
        readonly default: 'best';
        readonly description: 'Full-text source: best (default), allIndexed PDFs, or specified attachmentRefs.';
    };
    readonly attachmentRefs: {
        readonly type: 'array';
        readonly items: {
            readonly type: 'string';
        };
        readonly description: 'For specified: attachment refs belonging to ref in the same library and instance; repeats read once, bounded by retrieveAttachmentCap.';
    };
};
type RetrieveArgs = InferArgs<typeof RETRIEVE_PARAMETERS>;
declare const RETRIEVE_OUTPUT_SCHEMA: {
    readonly type: 'object';
    readonly additionalProperties: false;
    readonly properties: {
        readonly ref: {
            readonly type: 'string';
            readonly required: true;
        };
        readonly attachmentRef: {
            readonly type: 'string';
        };
        readonly attachmentContentType: {
            readonly type: 'string';
        };
        readonly textFormat: {
            readonly type: 'string';
            readonly enum: readonly ['markdown', 'text'];
        };
        readonly artifact: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly parser: {
                    readonly type: 'string';
                    readonly enum: readonly ['mineru'];
                    readonly required: true;
                };
                readonly mode: {
                    readonly type: 'string';
                    readonly enum: readonly ['free', 'pro'];
                    readonly required: true;
                };
                readonly artifactId: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly fingerprint: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly sourceId: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly generation: {
                    readonly type: 'string';
                    readonly required: true;
                };
            };
        };
        readonly coverage: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly indexedPages: {
                    readonly type: 'integer';
                };
                readonly totalPages: {
                    readonly type: 'integer';
                };
                readonly indexedChars: {
                    readonly type: 'integer';
                };
                readonly totalChars: {
                    readonly type: 'integer';
                };
                readonly complete: {
                    readonly type: 'boolean';
                    readonly required: true;
                };
            };
        };
        readonly attachments: {
            readonly type: 'array';
            readonly items: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly ref: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly contentType: {
                        readonly type: 'string';
                    };
                    readonly status: {
                        readonly type: 'string';
                        readonly enum: readonly ['indexed', 'unindexed', 'unread'];
                        readonly required: true;
                    };
                    readonly textFormat: {
                        readonly type: 'string';
                        readonly enum: readonly ['markdown', 'text'];
                    };
                    readonly artifact: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly parser: {
                                readonly type: 'string';
                                readonly enum: readonly ['mineru'];
                                readonly required: true;
                            };
                            readonly mode: {
                                readonly type: 'string';
                                readonly enum: readonly ['free', 'pro'];
                                readonly required: true;
                            };
                            readonly artifactId: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly fingerprint: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly sourceId: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly generation: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                        };
                    };
                    readonly coverage: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly indexedPages: {
                                readonly type: 'integer';
                            };
                            readonly totalPages: {
                                readonly type: 'integer';
                            };
                            readonly indexedChars: {
                                readonly type: 'integer';
                            };
                            readonly totalChars: {
                                readonly type: 'integer';
                            };
                            readonly complete: {
                                readonly type: 'boolean';
                                readonly required: true;
                            };
                        };
                    };
                    readonly inputTruncated: {
                        readonly type: 'boolean';
                    };
                    readonly passages: {
                        readonly type: 'integer';
                    };
                };
            };
        };
        readonly evidence: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly source: {
                        readonly type: 'string';
                        readonly enum: import("../evidence-item.js").EvidenceSource[];
                        readonly required: true;
                    };
                    readonly sourceRef: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly text: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly textFormat: {
                        readonly type: 'string';
                        readonly enum: readonly ['markdown', 'text'];
                    };
                    readonly artifact: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly parser: {
                                readonly type: 'string';
                                readonly enum: readonly ['mineru'];
                                readonly required: true;
                            };
                            readonly mode: {
                                readonly type: 'string';
                                readonly enum: readonly ['free', 'pro'];
                                readonly required: true;
                            };
                            readonly artifactId: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly fingerprint: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly sourceId: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly generation: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                        };
                    };
                    readonly start: {
                        readonly type: 'integer';
                    };
                    readonly end: {
                        readonly type: 'integer';
                    };
                    readonly chunkIndex: {
                        readonly type: 'integer';
                    };
                    readonly chunkCount: {
                        readonly type: 'integer';
                    };
                    readonly comment: {
                        readonly type: 'string';
                    };
                    readonly pageLabel: {
                        readonly type: 'string';
                    };
                    readonly attachmentRef: {
                        readonly type: 'string';
                    };
                    readonly matchKind: {
                        readonly type: 'string';
                        readonly enum: readonly ['lexical', 'semantic', 'hybrid'];
                        readonly required: true;
                    };
                    readonly matchedFields: {
                        readonly type: 'array';
                        readonly items: {
                            readonly type: 'string';
                            readonly enum: readonly ['text', 'comment'];
                        };
                    };
                };
            };
        };
        readonly truncated: {
            readonly type: 'boolean';
            readonly required: true;
        };
        readonly sourcesSkipped: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly type: 'string';
                readonly enum: readonly ['annotation', 'note', 'abstract', 'fulltext'];
            };
        };
        readonly queryTerms: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly type: 'string';
            };
        };
        readonly noMatch: {
            readonly type: 'string';
            readonly enum: readonly ['no-overlap', 'no-sources'];
        };
        readonly rankedRoutes: {
            readonly type: 'array';
            readonly items: {
                readonly type: 'string';
                readonly enum: readonly ['lexical', 'semantic'];
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
/** The one-line note explaining what a semantic-only hit did and did not do. */
export declare const SEMANTIC_ONLY_NOTE = "matched on meaning, not on wording: do not quote this passage as containing the query\u2019s terms";
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
/**
 * What an empty evidence list means when the semantic route ran: neither the
 * query's words nor its meaning scored any passage. The call establishes only
 * this, not that the item has nothing on the subject.
 */
export declare const NO_MATCH_MESSAGE = "No passage matched this query \u2014 neither its terms nor its meaning. That describes this query against the sources this call read; it is not evidence that the item has nothing on the subject.";
/**
 * The same fact when only the lexical route ran; no semantic comparison was
 * made because semantic ranking was off or its model did not answer.
 */
export declare const NO_MATCH_TERMS_ONLY_MESSAGE = "No passage matched this query\u2019s terms (semantic ranking was not part of this call). That describes this query against the sources this call read; it is not evidence that the item has nothing on the subject.";
/** The remedy half of {@link NO_MATCH_MESSAGE}. */
export declare const NO_MATCH_REMEDY = "Rephrase with the subject\u2019s own terms, pass queryVariants with your own paraphrases, or widen sources.";
/**
 * The message when the item offered no rankable passage at all; the overlap
 * test did not run.
 */
export declare const NO_SOURCES_MESSAGE = "This item offered no rankable passage \u2014 no annotation, note, abstract, or indexed full text \u2014 so no overlap test ran. It is not evidence about the item\u2019s content.";
/** The remedy half of {@link NO_SOURCES_MESSAGE}. */
export declare const NO_SOURCES_REMEDY = "Check that the item has an indexed attachment, or read its files directly with zotero_get.";
/**
 * Why an empty answer is expected: the query carried nothing the lexical route
 * could score.
 */
export declare const NO_CONTENT_TERMS_MESSAGE = "The query carried no content words (\u201Cthe\u201D, \u201Cof\u201D and the like are dropped before scoring), so there was nothing to match; ask with the subject\u2019s own terms.";
export declare function renderRetrieve(_args: RetrieveArgs, value: RetrieveOutput): ContentBlock[];
/**
 * Register the `zotero_retrieve` tool. The service's live config is read per
 * request so a settings edit takes effect on the next call without
 * re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export declare function registerRetrieveTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): void;
export {};
//# sourceMappingURL=retrieve.d.ts.map