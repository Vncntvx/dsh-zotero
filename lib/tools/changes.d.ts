/**
 * The `zotero_changes` tool: incremental awareness of the local library. On
 * the verified build (Zotero 10.0.2-beta.9) versions are local transactions:
 * every object save advances the library counter and stamps the object. A
 * `since` diff therefore answers "what changed in my library" request-driven,
 * without the cloud and without background polling. The domain decides that per call from
 * the responses (a build that reports no library version is `versionUnavailable`)
 * rather than from a version number, which no response header carries. A call
 * without `since` takes a baseline reading and mints the cursor (version plus
 * the instance and library it belongs to) that later calls pass back.
 * @module dsh-zotero/tools/changes
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroChangesInclude, ZoteroChangesUnobservableReason } from '../types.js';
import type { ZoteroService } from '../service.js';
declare const CHANGES_WITH_BACKGROUND_PARAMETERS: {
    readonly run_in_background: {
        readonly type: "boolean";
        readonly description: "Run in the background and return a job id immediately (collect with job_output, stop with job_kill).";
    };
    readonly library: {
        readonly description: "Library to diff; omitted defaults to personal user/0.";
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
    readonly since: {
        readonly description: "The cursor to diff from, passed back verbatim from an earlier zotero_changes result. It carries the instance, the library, the version, and the resource kinds it covers: a bare version number is not accepted, because the same number means an unrelated counter in another database or library. A cursor from another instance is rejected, one for another library is an argument error, and its include set must match this call. Never advance from a result without a cursor: that read did not verify the whole range. Omit to take a baseline reading (current version, no diffs).";
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly serverId: {
                readonly type: "string";
                readonly required: true;
            };
            readonly library: {
                readonly required: true;
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
            readonly version: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly include: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                    readonly enum: readonly ZoteroChangesInclude[];
                };
            };
        };
    };
    readonly include: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
            readonly enum: readonly ZoteroChangesInclude[];
        };
        readonly default: ZoteroChangesInclude[];
        readonly description: "Resource kinds to diff; defaults to everything but fulltext. items covers the whole item space as Zotero partitions it: top-level items, child objects (notes, attachments, annotations), and items in the trash. Each is reported as its own list, because a child object carries its own version: editing one advances the library without touching any top-level item. deleted lists tombstoned items, collections, saved searches and tag names. fulltext is a separate listing: its endpoint answers in the full-text index’s own version counter, so its rows are not a delta on the library version and it is left out unless named explicitly.";
    };
};
type ChangesArgs = InferArgs<typeof CHANGES_WITH_BACKGROUND_PARAMETERS>;
declare const CHANGED_OBJECT: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly key: {
            readonly type: "string";
            readonly required: true;
        };
        readonly version: {
            readonly type: "integer";
            readonly required: true;
        };
    };
};
type ChangesArraySchema = {
    readonly type: 'array';
    readonly items: typeof CHANGED_OBJECT;
};
type DeletedArraySchema = {
    readonly type: 'array';
    readonly required: true;
    readonly items: {
        readonly type: 'string';
    };
};
type IntegerSchema = {
    readonly type: 'integer';
};
/**
 * The ways a kind this call included can contribute nothing, each with the
 * line the model reads. The reasons are kept apart because the remedy differs:
 * a missing endpoint is permanent, a range older than the build's history is
 * fixed by re-baselining, and an unreadable answer is fixed by running the
 * call again. The schema's enum is derived from these keys, so a new reason
 * cannot reach the wire unrendered.
 */
export declare const UNOBSERVABLE_NOT_SERVED_MESSAGE = "Not served by this Zotero build (not observable here, removals included)";
export declare const UNOBSERVABLE_RANGE_NOT_COVERED_MESSAGE = "Older than the change history this build keeps (take a fresh baseline to track it from here)";
export declare const UNOBSERVABLE_UNREADABLE_MESSAGE = "The answer did not carry the documented shape, so this call could not read it (re-run)";
declare const CHANGES_OUTPUT_SCHEMA: {
    readonly oneOf: readonly [{
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly required: true;
                readonly const: "background";
            };
            readonly jobId: {
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
                readonly required: true;
                readonly const: "promoted";
            };
            readonly jobId: {
                readonly type: "string";
                readonly required: true;
            };
            readonly timeoutMs: {
                readonly type: "number";
                readonly required: true;
            };
            readonly message: {
                readonly type: "string";
                readonly required: true;
            };
        };
    }, {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
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
            };
            readonly serverId: {
                readonly type: "string";
            };
            readonly fromVersion: {
                readonly type: "integer";
            };
            readonly cursor: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly serverId: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly library: {
                        readonly required: true;
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
                    readonly version: {
                        readonly type: "integer";
                        readonly required: true;
                    };
                    readonly include: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                            readonly enum: readonly ZoteroChangesInclude[];
                        };
                        readonly required: true;
                    };
                };
            };
            readonly libraryChanged: {
                readonly type: "boolean";
            };
            readonly versionUnavailable: {
                readonly type: "boolean";
            };
            readonly changed: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly required: true;
                readonly properties: {
                    items: ChangesArraySchema;
                    childItems: ChangesArraySchema;
                    trashedItems: ChangesArraySchema;
                    collections: ChangesArraySchema;
                    savedSearches: ChangesArraySchema;
                    fulltextAttachments: ChangesArraySchema;
                };
            };
            readonly deleted: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    items: DeletedArraySchema;
                    collections: DeletedArraySchema;
                    savedSearches: DeletedArraySchema;
                    tags: DeletedArraySchema;
                };
            };
            readonly totals: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    items: IntegerSchema;
                    childItems: IntegerSchema;
                    trashedItems: IntegerSchema;
                    collections: IntegerSchema;
                    savedSearches: IntegerSchema;
                    fulltextAttachments: IntegerSchema;
                    deletedItems: IntegerSchema;
                    deletedCollections: IntegerSchema;
                    deletedSavedSearches: IntegerSchema;
                    deletedTags: IntegerSchema;
                    deletedOther: IntegerSchema;
                };
            };
            readonly unobservable: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly kind: {
                            readonly type: "string";
                            readonly enum: readonly ZoteroChangesInclude[];
                            readonly required: true;
                        };
                        readonly reason: {
                            readonly type: "string";
                            readonly enum: readonly ZoteroChangesUnobservableReason[];
                            readonly required: true;
                        };
                    };
                };
            };
            readonly truncated: {
                readonly type: "boolean";
            };
        };
    }];
};
type ChangesOutput = InferValue<typeof CHANGES_OUTPUT_SCHEMA>;
/** The model-facing message for an explicit empty include list. */
export declare const CHANGES_INCLUDE_EMPTY_MESSAGE = "include must list at least one resource kind when provided";
/** The note that full-text rows are a listing, not a delta on the library version. */
export declare const FULLTEXT_COUNTER_NOTE = "index versions are a counter of their own, so these rows are a listing, not this version\u2019s change set";
/**
 * The baseline and diff messages the model reads: the three baseline outcomes
 * (a cursor, a version without an instance, and no version at all) and the
 * three ways a diff withholds its cursor.
 */
export declare function baselineCursorMessage(version: number, serverId: string): string;
/** The instruction a cursor baseline closes with. */
export declare const BASELINE_CURSOR_REUSE = "Pass that cursor back as since on a later call to see what changed.";
export declare const BASELINE_NO_VERSION_MESSAGE = "Baseline reading: this Zotero build reports no library version, so there is no cursor to diff from, and incremental changes cannot be read here.";
export declare const BASELINE_NO_INSTANCE_MESSAGE = "Baseline reading: the library is at a version, but the answering build named no instance to pin a cursor to, so there is nothing to pass back.";
export declare const CHANGES_NOT_ADVANCED_LIBRARY_MOVED = "version not advanced: the library changed while this call was reading; re-run for a settled cursor.";
export declare const CHANGES_NOT_ADVANCED_NO_VERSION = "version not advanced: this Zotero build reported no library version for this read, so the diff cannot be pinned to one.";
export declare const CHANGES_NOT_ADVANCED_UNVERIFIED = "version not advanced: the read did not verify the whole range; do not reuse a version from this call.";
export declare const CHANGES_NOT_ADVANCED_FULLTEXT = "version not advanced: fulltext uses an independent index counter, so this mixed listing has no library cursor; run a library-only diff when you need a resumable cursor.";
/** The positive statement an observed, empty tombstone read renders. */
export declare const CHANGES_NO_DELETIONS_MESSAGE = "Deletions: none in this range.";
/** The note that tombstoned kinds outside this tool's reports were counted too. */
export declare function otherDeletedMessage(count: number): string;
export declare function renderChanges(args: ChangesArgs, value: ChangesOutput): ContentBlock[];
export declare function registerChangesTool(ctx: Context, service: ZoteroService, enableBackground: boolean): () => void;
export {};
//# sourceMappingURL=changes.d.ts.map