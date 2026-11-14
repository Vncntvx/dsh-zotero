/**
 * The wire boundary's single source: every zod schema the `zotero` namespace
 * validates with, and the one shared invocation list both halves register.
 * `ZOTERO_COMMON_INVOCATIONS` materializes each schema once through
 * `strictCodec()`; the host manifest aliases it in `src/status-codec.ts` and
 * the browser face aliases it in `src/client/status-codec.ts`. Neither half
 * imports the other's module or builds its own descriptor list, so the two
 * sides cannot disagree about a boundary.
 *
 * Client-safe: its imports are `zod`, the contract's own types, type-only
 * domain unions from `types.ts` (erased at build), and the runtime constants
 * module (values and type-only imports only), all of which
 * `scripts/client-graph-authority.mjs` allowlists. The sort enum derives from
 * `src/constants.ts`, the export enums derive from the sibling arrays there,
 * and the updatable-field set is pinned to it by
 * `tests/unit/wire-schemas.spec.ts`. The parity specs read both arms and keep
 * a hand-written refusal table per schema.
 * @module dsh-zotero/wire-schemas
 */
import { z } from 'zod';
import type { InvocationDescriptor, TypertCodec } from '@deepseek-ai/dsh-typert-protocol';
import type { ZoteroChildRowsView } from './contract.js';
/**
 * The panel's sort fields, derived from the domain's one array so the two
 * cannot drift (`tests/unit/wire-schemas.spec.ts` additionally pins the
 * exact order).
 */
export declare const zoteroLibrarySortSchema: z.ZodEnum<{
    creator: "creator";
    date: "date";
    dateAdded: "dateAdded";
    dateModified: "dateModified";
    title: "title";
}>;
/**
 * Wrap a wire schema in the strict codec arm Typert expects. The strict arm is
 * exactly `{ mode, typeSymbol, create }` (plus optional `encode`/`decode` for
 * byte-carrying results, which these pure-JSON views do not need), so no live
 * schema property is carried and `create()` materializes on first use.
 * @param typeSymbol - the boundary type identity the manifest declares.
 * @param schema - the shared wire schema both halves validate through.
 * @returns the strict codec arm.
 */
export declare function strictCodec(typeSymbol: string, schema: z.ZodType): Extract<TypertCodec, {
    mode: 'strict';
}>;
/** Wire schema: one status view (strict; absent optional facts stay absent). */
export declare const zoteroStatusSchema: z.ZodReadonly<z.ZodObject<{
    providerId: z.ZodString;
    sourceProjection: z.ZodDiscriminatedUnion<[z.ZodObject<{
        state: z.ZodLiteral<"not-composed">;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodLiteral<"pending">;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodLiteral<"ready">;
    }, z.core.$strict>, z.ZodObject<{
        state: z.ZodLiteral<"failed">;
        code: z.ZodLiteral<"ZOTERO_SOURCE_PROJECTION_FAILED">;
    }, z.core.$strict>], "state">;
    endpoint: z.ZodOptional<z.ZodString>;
    connected: z.ZodBoolean;
    apiVersion: z.ZodOptional<z.ZodString>;
    serverId: z.ZodOptional<z.ZodString>;
    schemaVersion: z.ZodOptional<z.ZodString>;
    zoteroVersion: z.ZodOptional<z.ZodString>;
    write: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodBoolean;
        authorized: z.ZodBoolean;
    }, z.core.$strict>>;
    diagnosis: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
/** Wire schema: resolveAttachment parameter (a non-empty string ref). */
export declare const zoteroRefSchema: z.ZodString;
/** Wire schema: resolveAttachment result. */
export declare const zoteroAttachmentLocationSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    kind: z.ZodEnum<{
        file: "file";
        url: "url";
    }>;
    title: z.ZodString;
    contentType: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
/** Wire schema: the write-grant revocation result (strict). */
export declare const zoteroWriteGrantRevokeSchema: z.ZodObject<{
    removed: z.ZodBoolean;
}, z.core.$strict>;
/** Wire schema: one diagnostics snapshot (strict; the ring pre-strips absent optionals). */
export declare const zoteroDiagnosticsSchema: z.ZodReadonly<z.ZodObject<{
    entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodNumber;
        level: z.ZodEnum<{
            debug: "debug";
            error: "error";
            info: "info";
            warn: "warn";
        }>;
        event: z.ZodString;
        message: z.ZodString;
        count: z.ZodNumber;
        detail: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
    }, z.core.$strict>>>>;
    total: z.ZodNumber;
    truncated: z.ZodBoolean;
    debug: z.ZodBoolean;
}, z.core.$strict>>;
/** Wire schema: reportClientError parameter (surface + message required, stacks optional). */
export declare const zoteroClientErrorReportSchema: z.ZodReadonly<z.ZodObject<{
    surface: z.ZodString;
    message: z.ZodString;
    stack: z.ZodOptional<z.ZodString>;
    componentStack: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
/** Wire schema: reportClientError result (the ring sequence the report was assigned). */
export declare const zoteroReportResultSchema: z.ZodReadonly<z.ZodObject<{
    seq: z.ZodNumber;
}, z.core.$strict>>;
/** Wire schema: openProtocol parameter (a string starting with zotero://). */
export declare const zoteroProtocolUrlSchema: z.ZodString;
/** Wire schema: openProtocol result. */
export declare const zoteroOpenProtocolResultSchema: z.ZodReadonly<z.ZodObject<{
    success: z.ZodLiteral<true>;
}, z.core.$strict>>;
export declare const zoteroSourcePageTargetSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"sources">;
    filter: z.ZodEnum<{
        all: "all";
        evidence: "evidence";
        exported: "exported";
        issues: "issues";
        pdf: "pdf";
        retrieved: "retrieved";
    }>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"source">;
    key: z.ZodString;
    rows: z.ZodEnum<{
        evidence: "evidence";
        exports: "exports";
        searches: "searches";
    }>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"session">;
    rows: z.ZodLiteral<"exports">;
}, z.core.$strict>], "kind">;
export declare const zoteroSourcePageRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"sources">;
        filter: z.ZodEnum<{
            all: "all";
            evidence: "evidence";
            exported: "exported";
            issues: "issues";
            pdf: "pdf";
            retrieved: "retrieved";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"source">;
        key: z.ZodString;
        rows: z.ZodEnum<{
            evidence: "evidence";
            exports: "exports";
            searches: "searches";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"session">;
        rows: z.ZodLiteral<"exports">;
    }, z.core.$strict>], "kind">;
    currentServerId: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
    revision: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const zoteroSourcePageResultSchema: z.ZodObject<{
    sessionId: z.ZodString;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"sources">;
        filter: z.ZodEnum<{
            all: "all";
            evidence: "evidence";
            exported: "exported";
            issues: "issues";
            pdf: "pdf";
            retrieved: "retrieved";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"source">;
        key: z.ZodString;
        rows: z.ZodEnum<{
            evidence: "evidence";
            exports: "exports";
            searches: "searches";
        }>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"session">;
        rows: z.ZodLiteral<"exports">;
    }, z.core.$strict>], "kind">;
    revision: z.ZodNumber;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    total: z.ZodNumber;
    workspace: z.ZodObject<{
        sources: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            ref: z.ZodString;
            serverIds: z.ZodArray<z.ZodString>;
            evidenceMatch: z.ZodEnum<{
                mismatch: "mismatch";
                unknown: "unknown";
                verified: "verified";
            }>;
            title: z.ZodOptional<z.ZodString>;
            creators: z.ZodOptional<z.ZodString>;
            year: z.ZodOptional<z.ZodNumber>;
            venue: z.ZodOptional<z.ZodString>;
            facts: z.ZodObject<{
                reportedEvidenceCount: z.ZodNumber;
            }, z.core.$strict>;
            operations: z.ZodObject<{
                running: z.ZodNumber;
                failed: z.ZodNumber;
                stopped: z.ZodNumber;
            }, z.core.$strict>;
            searches: z.ZodArray<z.ZodObject<{
                callId: z.ZodString;
                query: z.ZodOptional<z.ZodString>;
                mode: z.ZodEnum<{
                    everything: "everything";
                    metadata: "metadata";
                }>;
                scope: z.ZodUnion<readonly [z.ZodObject<{
                    kind: z.ZodLiteral<"library">;
                    library: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
                        type: z.ZodLiteral<"user">;
                        id: z.ZodLiteral<0>;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"group">;
                        id: z.ZodNumber;
                    }, z.core.$strict>]>>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"publications">;
                    library: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
                        type: z.ZodLiteral<"user">;
                        id: z.ZodLiteral<0>;
                    }, z.core.$strict>, z.ZodObject<{
                        type: z.ZodLiteral<"group">;
                        id: z.ZodNumber;
                    }, z.core.$strict>]>>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"collection">;
                    ref: z.ZodOptional<z.ZodString>;
                    name: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"savedSearch">;
                    ref: z.ZodOptional<z.ZodString>;
                    name: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>]>;
                library: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"user">;
                    id: z.ZodLiteral<0>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"group">;
                    id: z.ZodNumber;
                }, z.core.$strict>]>>;
                itemTypes: z.ZodArray<z.ZodString>;
                tags: z.ZodArray<z.ZodString>;
                tagMatch: z.ZodOptional<z.ZodEnum<{
                    all: "all";
                    any: "any";
                }>>;
                excludeTags: z.ZodArray<z.ZodString>;
                includeTrashed: z.ZodBoolean;
                returned: z.ZodNumber;
                total: z.ZodOptional<z.ZodNumber>;
                noteMatches: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>;
            searchesTotal: z.ZodNumber;
            evidence: z.ZodArray<z.ZodObject<{
                source: z.ZodString;
                sourceRef: z.ZodString;
                text: z.ZodString;
                previewTruncated: z.ZodBoolean;
                textFormat: z.ZodOptional<z.ZodEnum<{
                    markdown: "markdown";
                    text: "text";
                }>>;
                artifact: z.ZodOptional<z.ZodObject<{
                    parser: z.ZodLiteral<"mineru">;
                    mode: z.ZodEnum<{
                        free: "free";
                        pro: "pro";
                    }>;
                    artifactId: z.ZodString;
                    fingerprint: z.ZodString;
                    sourceId: z.ZodString;
                    generation: z.ZodString;
                }, z.core.$strict>>;
                start: z.ZodOptional<z.ZodNumber>;
                end: z.ZodOptional<z.ZodNumber>;
                pageLabel: z.ZodOptional<z.ZodString>;
                attachmentRef: z.ZodOptional<z.ZodString>;
                callIds: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>;
            evidenceTotal: z.ZodNumber;
            bestAttachment: z.ZodOptional<z.ZodObject<{
                ref: z.ZodOptional<z.ZodString>;
                contentType: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            attachment: z.ZodOptional<z.ZodObject<{
                ref: z.ZodOptional<z.ZodString>;
                kind: z.ZodEnum<{
                    file: "file";
                    url: "url";
                }>;
                contentType: z.ZodString;
                title: z.ZodString;
                location: z.ZodString;
            }, z.core.$strict>>;
            retrievalFacts: z.ZodOptional<z.ZodObject<{
                attachmentRef: z.ZodOptional<z.ZodString>;
                attachmentContentType: z.ZodOptional<z.ZodString>;
                coverage: z.ZodOptional<z.ZodObject<{
                    indexedPages: z.ZodOptional<z.ZodNumber>;
                    totalPages: z.ZodOptional<z.ZodNumber>;
                    indexedChars: z.ZodOptional<z.ZodNumber>;
                    totalChars: z.ZodOptional<z.ZodNumber>;
                    complete: z.ZodBoolean;
                }, z.core.$strict>>;
                truncated: z.ZodBoolean;
                sourceAvailability: z.ZodRecord<z.ZodString, z.ZodObject<{
                    requested: z.ZodBoolean;
                    returnedPassages: z.ZodNumber;
                    unavailable: z.ZodBoolean;
                }, z.core.$strict>>;
            }, z.core.$strict>>;
            retrievalSummary: z.ZodOptional<z.ZodObject<{
                runCount: z.ZodNumber;
                truncated: z.ZodBoolean;
            }, z.core.$strict>>;
            exports: z.ZodArray<z.ZodObject<{
                resultFile: z.ZodOptional<z.ZodObject<{
                    seq: z.ZodNumber;
                    index: z.ZodNumber;
                }, z.core.$strict>>;
                callId: z.ZodString;
                format: z.ZodString;
                style: z.ZodOptional<z.ZodString>;
                locale: z.ZodOptional<z.ZodString>;
                refs: z.ZodArray<z.ZodString>;
                refsOmitted: z.ZodNumber;
                settledAt: z.ZodOptional<z.ZodNumber>;
                items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    ref: z.ZodString;
                    exportKey: z.ZodOptional<z.ZodString>;
                    citationKey: z.ZodOptional<z.ZodString>;
                    citationKeySource: z.ZodOptional<z.ZodEnum<{
                        extra: "extra";
                        native: "native";
                    }>>;
                    citationKeyConflict: z.ZodOptional<z.ZodObject<{
                        native: z.ZodString;
                        extra: z.ZodString;
                    }, z.core.$strict>>;
                    title: z.ZodOptional<z.ZodString>;
                    entryIndex: z.ZodOptional<z.ZodNumber>;
                    start: z.ZodOptional<z.ZodNumber>;
                    end: z.ZodOptional<z.ZodNumber>;
                }, z.core.$strict>>>;
                text: z.ZodString;
            }, z.core.$strict>>;
            exportsTotal: z.ZodNumber;
            firstSeenAt: z.ZodNumber;
            lastTouchedAt: z.ZodNumber;
        }, z.core.$strict>>;
        sourceTotal: z.ZodNumber;
        exports: z.ZodArray<z.ZodObject<{
            resultFile: z.ZodOptional<z.ZodObject<{
                seq: z.ZodNumber;
                index: z.ZodNumber;
            }, z.core.$strict>>;
            callId: z.ZodString;
            format: z.ZodString;
            style: z.ZodOptional<z.ZodString>;
            locale: z.ZodOptional<z.ZodString>;
            refs: z.ZodArray<z.ZodString>;
            refsOmitted: z.ZodNumber;
            settledAt: z.ZodOptional<z.ZodNumber>;
            items: z.ZodOptional<z.ZodArray<z.ZodObject<{
                ref: z.ZodString;
                exportKey: z.ZodOptional<z.ZodString>;
                citationKey: z.ZodOptional<z.ZodString>;
                citationKeySource: z.ZodOptional<z.ZodEnum<{
                    extra: "extra";
                    native: "native";
                }>>;
                citationKeyConflict: z.ZodOptional<z.ZodObject<{
                    native: z.ZodString;
                    extra: z.ZodString;
                }, z.core.$strict>>;
                title: z.ZodOptional<z.ZodString>;
                entryIndex: z.ZodOptional<z.ZodNumber>;
                start: z.ZodOptional<z.ZodNumber>;
                end: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strict>>>;
            text: z.ZodString;
        }, z.core.$strict>>;
        exportTotal: z.ZodNumber;
        exportOperations: z.ZodObject<{
            running: z.ZodNumber;
            failed: z.ZodNumber;
            stopped: z.ZodNumber;
        }, z.core.$strict>;
        omittedRows: z.ZodNumber;
        filterCounts: z.ZodObject<{
            all: z.ZodNumber;
            pdf: z.ZodNumber;
            retrieved: z.ZodNumber;
            evidence: z.ZodNumber;
            exported: z.ZodNumber;
            issues: z.ZodNumber;
        }, z.core.$strict>;
        evidencePassageTotal: z.ZodNumber;
        exportedRefCount: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
/** Wire schema: the canonical personal library (user/0) on its own. */
export declare const zoteroPersonalLibrarySchema: z.ZodReadonly<z.ZodObject<{
    type: z.ZodLiteral<"user">;
    id: z.ZodLiteral<0>;
}, z.core.$strict>>;
/** Wire schema: one supported local library (canonical personal or a group). */
export declare const zoteroLibrarySchema: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
    type: z.ZodLiteral<"user">;
    id: z.ZodLiteral<0>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    type: z.ZodLiteral<"group">;
    id: z.ZodNumber;
}, z.core.$strict>>]>;
/** Wire schema: the resolved scope a search result echoes back. */
export declare const zoteroResolvedScopeSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"library">;
    library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"publications">;
    library: z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"collection">;
    ref: z.ZodString;
    name: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"savedSearch">;
    ref: z.ZodString;
    name: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"trash">;
    library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>;
}, z.core.$strict>>], "kind">;
/** Wire schema: browse request (one bounded navigation listing). */
export declare const zoteroLibraryBrowseRequestSchema: z.ZodReadonly<z.ZodObject<{
    kind: z.ZodEnum<{
        collections: "collections";
        itemTypes: "itemTypes";
        libraries: "libraries";
        savedSearches: "savedSearches";
        tags: "tags";
    }>;
    library: z.ZodOptional<z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>>;
    parentRef: z.ZodOptional<z.ZodString>;
    q: z.ZodOptional<z.ZodString>;
    match: z.ZodOptional<z.ZodEnum<{
        contains: "contains";
        startsWith: "startsWith";
    }>>;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
}, z.core.$strict>>;
/** Wire schema: browse result rows, discriminated by `kind` unlike the domain union. */
export declare const zoteroSavedSearchConditionSchema: z.ZodReadonly<z.ZodObject<{
    condition: z.ZodString;
    operator: z.ZodString;
    value: z.ZodString;
}, z.core.$strict>>;
/** Wire schema: one collection row, shared by browse listings and path breadcrumbs. */
export declare const zoteroCollectionRowSchema: z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"collection">;
    ref: z.ZodString;
    name: z.ZodString;
    parentRef: z.ZodOptional<z.ZodString>;
    path: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    depth: z.ZodNumber;
    childCount: z.ZodOptional<z.ZodNumber>;
    itemCount: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>>;
export declare const zoteroLibraryBrowseItemSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"tag">;
    tag: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"itemType">;
    itemType: z.ZodString;
    localized: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"library">;
    library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>;
    name: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"collection">;
    ref: z.ZodString;
    name: z.ZodString;
    parentRef: z.ZodOptional<z.ZodString>;
    path: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    depth: z.ZodNumber;
    childCount: z.ZodOptional<z.ZodNumber>;
    itemCount: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"savedSearch">;
    ref: z.ZodString;
    name: z.ZodString;
    conditions: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        condition: z.ZodString;
        operator: z.ZodString;
        value: z.ZodString;
    }, z.core.$strict>>>>;
}, z.core.$strict>>], "kind">;
/** Wire schema: browse result (the requested page of one navigation listing). */
export declare const zoteroLibraryBrowseResultSchema: z.ZodReadonly<z.ZodObject<{
    libraryVersion: z.ZodOptional<z.ZodNumber>;
    kind: z.ZodEnum<{
        collections: "collections";
        itemTypes: "itemTypes";
        libraries: "libraries";
        savedSearches: "savedSearches";
        tags: "tags";
    }>;
    items: z.ZodReadonly<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"tag">;
        tag: z.ZodString;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"itemType">;
        itemType: z.ZodString;
        localized: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"library">;
        library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"user">;
            id: z.ZodLiteral<0>;
        }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"group">;
            id: z.ZodNumber;
        }, z.core.$strict>>]>;
        name: z.ZodString;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"collection">;
        ref: z.ZodString;
        name: z.ZodString;
        parentRef: z.ZodOptional<z.ZodString>;
        path: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        depth: z.ZodNumber;
        childCount: z.ZodOptional<z.ZodNumber>;
        itemCount: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"savedSearch">;
        ref: z.ZodString;
        name: z.ZodString;
        conditions: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
            condition: z.ZodString;
            operator: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>>>;
    }, z.core.$strict>>], "kind">>>;
    total: z.ZodNumber;
    offset: z.ZodNumber;
    returned: z.ZodNumber;
    limit: z.ZodNumber;
    nextOffset: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>>;
/** Wire schema: search request scope (the panel's scope set, including trash). */
export declare const zoteroLibrarySearchScopeSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"library">;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"publications">;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"collection">;
    refOrName: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"savedSearch">;
    refOrName: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"trash">;
}, z.core.$strict>>], "kind">;
/**
 * The library panel's item-list filters: one schema for the wire request and
 * the panel's stored state, so the two cannot drift (a tag spelling the wire
 * refuses must not survive in localStorage either).
 */
export declare const zoteroLibraryFiltersSchema: z.ZodObject<{
    itemTypes: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    tags: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    tagMatch: z.ZodOptional<z.ZodEnum<{
        all: "all";
        any: "any";
    }>>;
    yearFrom: z.ZodOptional<z.ZodNumber>;
    yearTo: z.ZodOptional<z.ZodNumber>;
    hasAttachment: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/** Wire schema: search request (one item-list page over one scope). */
export declare const zoteroLibrarySearchRequestSchema: z.ZodReadonly<z.ZodObject<{
    itemTypes: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    tags: z.ZodOptional<z.ZodReadonly<z.ZodArray<z.ZodString>>>;
    tagMatch: z.ZodOptional<z.ZodEnum<{
        all: "all";
        any: "any";
    }>>;
    yearFrom: z.ZodOptional<z.ZodNumber>;
    yearTo: z.ZodOptional<z.ZodNumber>;
    hasAttachment: z.ZodOptional<z.ZodBoolean>;
    scope: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"library">;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"publications">;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"collection">;
        refOrName: z.ZodString;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"savedSearch">;
        refOrName: z.ZodString;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"trash">;
    }, z.core.$strict>>], "kind">;
    library: z.ZodOptional<z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>>;
    q: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<{
        everything: "everything";
        metadata: "metadata";
    }>>;
    sort: z.ZodEnum<{
        creator: "creator";
        date: "date";
        dateAdded: "dateAdded";
        dateModified: "dateModified";
        title: "title";
    }>;
    direction: z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    itemLevel: z.ZodOptional<z.ZodEnum<{
        all: "all";
        top: "top";
    }>>;
    cacheGeneration: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>>;
/** Wire schema: one item row of a listing (the domain's compact hit, mirrored). */
export declare const zoteroSearchItemSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    title: z.ZodString;
    creatorSummary: z.ZodString;
    year: z.ZodOptional<z.ZodNumber>;
    itemType: z.ZodString;
    parentRef: z.ZodOptional<z.ZodString>;
    bestAttachmentRef: z.ZodOptional<z.ZodString>;
    bestAttachmentType: z.ZodOptional<z.ZodString>;
    attachmentSize: z.ZodOptional<z.ZodNumber>;
    extra: z.ZodOptional<z.ZodString>;
    doi: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
/** Wire schema: search result (paged primary hits only; no note supplement crosses). */
export declare const zoteroSearchResultSchema: z.ZodReadonly<z.ZodObject<{
    scope: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"library">;
        library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"user">;
            id: z.ZodLiteral<0>;
        }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"group">;
            id: z.ZodNumber;
        }, z.core.$strict>>]>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"publications">;
        library: z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"user">;
            id: z.ZodLiteral<0>;
        }, z.core.$strict>>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"collection">;
        ref: z.ZodString;
        name: z.ZodString;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"savedSearch">;
        ref: z.ZodString;
        name: z.ZodString;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"trash">;
        library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"user">;
            id: z.ZodLiteral<0>;
        }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
            type: z.ZodLiteral<"group">;
            id: z.ZodNumber;
        }, z.core.$strict>>]>;
    }, z.core.$strict>>], "kind">;
    items: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        ref: z.ZodString;
        title: z.ZodString;
        creatorSummary: z.ZodString;
        year: z.ZodOptional<z.ZodNumber>;
        itemType: z.ZodString;
        parentRef: z.ZodOptional<z.ZodString>;
        bestAttachmentRef: z.ZodOptional<z.ZodString>;
        bestAttachmentType: z.ZodOptional<z.ZodString>;
        attachmentSize: z.ZodOptional<z.ZodNumber>;
        extra: z.ZodOptional<z.ZodString>;
        doi: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>>;
    total: z.ZodNumber;
    offset: z.ZodNumber;
    returned: z.ZodNumber;
    limit: z.ZodNumber;
    nextOffset: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>>;
/** Wire schema: item-detail request (one ref plus the child kinds to include). */
export declare const zoteroLibraryItemRequestSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    include: z.ZodReadonly<z.ZodArray<z.ZodEnum<{
        annotations: "annotations";
        attachments: "attachments";
        notes: "notes";
    }>>>;
    childPages: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        notes: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
            offset: z.ZodNumber;
            limit: z.ZodNumber;
        }, z.core.$strict>>>;
        attachments: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
            offset: z.ZodNumber;
            limit: z.ZodNumber;
        }, z.core.$strict>>>;
        annotations: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
            offset: z.ZodNumber;
            limit: z.ZodNumber;
        }, z.core.$strict>>>;
    }, z.core.$strict>>>;
}, z.core.$strict>>;
/** Wire schema: one child listing the detail view serves. */
export declare function childRowsSchema<T>(item: z.ZodType<T>): z.ZodType<ZoteroChildRowsView<T>>;
export declare const zoteroNoteRowSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    text: z.ZodString;
    truncated: z.ZodBoolean;
    parentRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const zoteroAnnotationRowSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    type: z.ZodString;
    text: z.ZodString;
    comment: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    pageLabel: z.ZodOptional<z.ZodString>;
    parentRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const zoteroAttachmentRowSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    title: z.ZodString;
    contentType: z.ZodString;
}, z.core.$strict>>;
/** Wire schema: one paged child-listing request. */
export declare const zoteroLibraryChildPageRequestSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    kind: z.ZodEnum<{
        annotations: "annotations";
        attachments: "attachments";
        notes: "notes";
    }>;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
}, z.core.$strict>>;
/** Wire schema: one child page, discriminated by the kind it carries. */
export declare const zoteroChildPageSchema: z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"notes">;
    page: z.ZodType<ZoteroChildRowsView<Readonly<{
        ref: string;
        text: string;
        truncated: boolean;
        parentRef?: string | undefined;
    }>>, unknown, z.core.$ZodTypeInternals<ZoteroChildRowsView<Readonly<{
        ref: string;
        text: string;
        truncated: boolean;
        parentRef?: string | undefined;
    }>>, unknown>>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"attachments">;
    page: z.ZodType<ZoteroChildRowsView<Readonly<{
        ref: string;
        title: string;
        contentType: string;
    }>>, unknown, z.core.$ZodTypeInternals<ZoteroChildRowsView<Readonly<{
        ref: string;
        title: string;
        contentType: string;
    }>>, unknown>>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    kind: z.ZodLiteral<"annotations">;
    page: z.ZodType<ZoteroChildRowsView<Readonly<{
        ref: string;
        type: string;
        text: string;
        comment?: string | undefined;
        color?: string | undefined;
        pageLabel?: string | undefined;
        parentRef?: string | undefined;
    }>>, unknown, z.core.$ZodTypeInternals<ZoteroChildRowsView<Readonly<{
        ref: string;
        type: string;
        text: string;
        comment?: string | undefined;
        color?: string | undefined;
        pageLabel?: string | undefined;
        parentRef?: string | undefined;
    }>>, unknown>>;
}, z.core.$strict>>], "kind">;
/** Wire schema: the item detail view (panel include set applied, absent sets stay absent). */
export declare const zoteroItemDetailSchema: z.ZodReadonly<z.ZodObject<{
    ref: z.ZodString;
    itemType: z.ZodString;
    title: z.ZodString;
    creators: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        creatorType: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        firstName: z.ZodOptional<z.ZodString>;
        lastName: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>>;
    extra: z.ZodOptional<z.ZodString>;
    date: z.ZodOptional<z.ZodString>;
    year: z.ZodOptional<z.ZodNumber>;
    venue: z.ZodOptional<z.ZodString>;
    doi: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    abstract: z.ZodOptional<z.ZodString>;
    abstractTruncated: z.ZodBoolean;
    noteBody: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        text: z.ZodString;
        truncated: z.ZodBoolean;
    }, z.core.$strict>>>;
    tags: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    collections: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        ref: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>>;
    children: z.ZodReadonly<z.ZodObject<{
        total: z.ZodNumber;
    }, z.core.$strict>>;
    bestAttachment: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        ref: z.ZodString;
        title: z.ZodString;
        contentType: z.ZodString;
    }, z.core.$strict>>>;
    notes: z.ZodOptional<z.ZodType<ZoteroChildRowsView<Readonly<{
        ref: string;
        text: string;
        truncated: boolean;
        parentRef?: string | undefined;
    }>>, unknown, z.core.$ZodTypeInternals<ZoteroChildRowsView<Readonly<{
        ref: string;
        text: string;
        truncated: boolean;
        parentRef?: string | undefined;
    }>>, unknown>>>;
    annotations: z.ZodOptional<z.ZodType<ZoteroChildRowsView<Readonly<{
        ref: string;
        type: string;
        text: string;
        comment?: string | undefined;
        color?: string | undefined;
        pageLabel?: string | undefined;
        parentRef?: string | undefined;
    }>>, unknown, z.core.$ZodTypeInternals<ZoteroChildRowsView<Readonly<{
        ref: string;
        type: string;
        text: string;
        comment?: string | undefined;
        color?: string | undefined;
        pageLabel?: string | undefined;
        parentRef?: string | undefined;
    }>>, unknown>>>;
    attachments: z.ZodOptional<z.ZodType<ZoteroChildRowsView<Readonly<{
        ref: string;
        title: string;
        contentType: string;
    }>>, unknown, z.core.$ZodTypeInternals<ZoteroChildRowsView<Readonly<{
        ref: string;
        title: string;
        contentType: string;
    }>>, unknown>>>;
}, z.core.$strict>>;
/** Wire schema: the export formats, derived from the domain's one ordered array. */
export declare const zoteroLibraryExportFormatSchema: z.ZodEnum<{
    biblatex: "biblatex";
    bibliography: "bibliography";
    bibtex: "bibtex";
    citation: "citation";
    csljson: "csljson";
    csv: "csv";
    ris: "ris";
}>;
/** Wire schema: the translator export formats, derived from the sibling array. */
export declare const zoteroLibraryItemizedExportFormatSchema: z.ZodEnum<{
    biblatex: "biblatex";
    bibtex: "bibtex";
    csljson: "csljson";
    ris: "ris";
}>;
/**
 * Wire schema: library export request. The refs bound is Zotero's own
 * `itemKey` per-request cap: the configured `maxExportRefs` gate runs in the
 * host service, where the live config is read.
 */
export declare const zoteroLibraryExportRequestSchema: z.ZodReadonly<z.ZodObject<{
    refs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    format: z.ZodEnum<{
        biblatex: "biblatex";
        bibliography: "bibliography";
        bibtex: "bibtex";
        citation: "citation";
        csljson: "csljson";
        csv: "csv";
        ris: "ris";
    }>;
    style: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
/**
 * Wire schema: library export result, discriminated by the exported format.
 * The panel endpoint serves rendered text only, so the translator arm carries
 * no per-document itemization.
 */
export declare const zoteroLibraryExportResultSchema: z.ZodReadonly<z.ZodDiscriminatedUnion<[z.ZodReadonly<z.ZodObject<{
    format: z.ZodLiteral<"citation">;
    style: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
    citations: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        ref: z.ZodString;
        text: z.ZodString;
    }, z.core.$strict>>>>;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    format: z.ZodLiteral<"bibliography">;
    style: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    format: z.ZodEnum<{
        biblatex: "biblatex";
        bibtex: "bibtex";
        csljson: "csljson";
        ris: "ris";
    }>;
    style: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
}, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
    format: z.ZodLiteral<"csv">;
    text: z.ZodString;
}, z.core.$strict>>], "format">>;
/**
 * Closed panel mutation union. Extra or malformed nested fields are rejected
 * at the gateway. `satisfies` pins the schema's output to the hand-written
 * `ZoteroLibraryWriteRequestView`, so drift between the two fails at compile
 * time.
 */
export declare const zoteroLibraryWriteRequestSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"updateItem">;
    args: z.ZodObject<{
        ref: z.ZodString;
        set: z.ZodObject<{
            title: z.ZodOptional<z.ZodString>;
            date: z.ZodOptional<z.ZodString>;
            url: z.ZodOptional<z.ZodString>;
            doi: z.ZodOptional<z.ZodString>;
            abstractNote: z.ZodOptional<z.ZodString>;
            publicationTitle: z.ZodOptional<z.ZodString>;
            extra: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"updateTags">;
    args: z.ZodObject<{
        ref: z.ZodString;
        add: z.ZodOptional<z.ZodArray<z.ZodString>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"updateMembership">;
    args: z.ZodObject<{
        ref: z.ZodString;
        add: z.ZodOptional<z.ZodArray<z.ZodString>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"createItem">;
    args: z.ZodObject<{
        itemType: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        url: z.ZodOptional<z.ZodString>;
        date: z.ZodOptional<z.ZodString>;
        doi: z.ZodOptional<z.ZodString>;
        abstractNote: z.ZodOptional<z.ZodString>;
        publicationTitle: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        collections: z.ZodOptional<z.ZodArray<z.ZodString>>;
        creators: z.ZodOptional<z.ZodArray<z.ZodObject<{
            creatorType: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            firstName: z.ZodOptional<z.ZodString>;
            lastName: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"createNote">;
    args: z.ZodObject<{
        markdown: z.ZodString;
        parentItem: z.ZodOptional<z.ZodString>;
        collections: z.ZodOptional<z.ZodArray<z.ZodString>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sourceRefs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"updateNote">;
    args: z.ZodObject<{
        ref: z.ZodString;
        markdown: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"createCollection">;
    args: z.ZodObject<{
        name: z.ZodString;
        parent: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"updateCollection">;
    args: z.ZodObject<{
        collection: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        parent: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"deleteCollection">;
    args: z.ZodObject<{
        collection: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"createSavedSearch">;
    args: z.ZodObject<{
        name: z.ZodString;
        conditions: z.ZodArray<z.ZodObject<{
            condition: z.ZodString;
            operator: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"updateSavedSearch">;
    args: z.ZodObject<{
        search: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        conditions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            condition: z.ZodString;
            operator: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"deleteSavedSearch">;
    args: z.ZodObject<{
        search: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"trash">;
    args: z.ZodObject<{
        refs: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"restore">;
    args: z.ZodObject<{
        refs: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    operation: z.ZodLiteral<"batch">;
    args: z.ZodObject<{
        create: z.ZodOptional<z.ZodArray<z.ZodObject<{
            itemType: z.ZodString;
            title: z.ZodOptional<z.ZodString>;
            url: z.ZodOptional<z.ZodString>;
            date: z.ZodOptional<z.ZodString>;
            doi: z.ZodOptional<z.ZodString>;
            abstractNote: z.ZodOptional<z.ZodString>;
            publicationTitle: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            collections: z.ZodOptional<z.ZodArray<z.ZodString>>;
            creators: z.ZodOptional<z.ZodArray<z.ZodObject<{
                creatorType: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                firstName: z.ZodOptional<z.ZodString>;
                lastName: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>>;
        }, z.core.$strict>>>;
        update: z.ZodOptional<z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            addTags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            removeTags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            addCollections: z.ZodOptional<z.ZodArray<z.ZodString>>;
            removeCollections: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>>;
        delete: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
}, z.core.$strict>], "operation">;
export declare const zoteroLibraryWriteResultSchema: z.ZodReadonly<z.ZodObject<{
    kind: z.ZodEnum<{
        applied: "applied";
        "committed-unverified": "committed-unverified";
        declined: "declined";
        failed: "failed";
    }>;
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export declare const zoteroCollectionPathRequestSchema: z.ZodReadonly<z.ZodObject<{
    library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>;
    ref: z.ZodString;
    libraryVersion: z.ZodNumber;
}, z.core.$strict>>;
export declare const zoteroCollectionPathResultSchema: z.ZodReadonly<z.ZodObject<{
    library: z.ZodUnion<readonly [z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"user">;
        id: z.ZodLiteral<0>;
    }, z.core.$strict>>, z.ZodReadonly<z.ZodObject<{
        type: z.ZodLiteral<"group">;
        id: z.ZodNumber;
    }, z.core.$strict>>]>;
    libraryVersion: z.ZodNumber;
    path: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        kind: z.ZodLiteral<"collection">;
        ref: z.ZodString;
        name: z.ZodString;
        parentRef: z.ZodOptional<z.ZodString>;
        path: z.ZodReadonly<z.ZodArray<z.ZodString>>;
        depth: z.ZodNumber;
        childCount: z.ZodOptional<z.ZodNumber>;
        itemCount: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>>>;
}, z.core.$strict>>;
export declare const ZOTERO_STATUS_RESULT_CODEC: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteValue<unknown> & {
    readonly mode: 'strict';
    readonly typeSymbol: string;
    readonly decode?: ((value: unknown) => unknown) | undefined;
    readonly encode?: ((value: unknown, writeBytes: (bytes: Uint8Array, path: readonly (string | number)[]) => null) => unknown) | undefined;
};
export declare const zoteroReadUrlPdfRequestSchema: z.ZodObject<{
    ref: z.ZodString;
}, z.core.$strict>;
export declare const zoteroUrlPdfSchema: z.ZodObject<{
    ref: z.ZodString;
    title: z.ZodString;
    contentType: z.ZodLiteral<"application/pdf">;
    path: z.ZodString;
    lease: z.ZodUUID;
}, z.core.$strict>;
export declare const ZOTERO_URL_PDF_CODEC: import("@deepseek-ai/dsh-typert-protocol").TypertRemoteValue<unknown> & {
    readonly mode: 'strict';
    readonly typeSymbol: string;
    readonly decode?: ((value: unknown) => unknown) | undefined;
    readonly encode?: ((value: unknown, writeBytes: (bytes: Uint8Array, path: readonly (string | number)[]) => null) => unknown) | undefined;
};
export declare const zoteroReleaseUrlPdfSchema: z.ZodObject<{
    lease: z.ZodUUID;
}, z.core.$strict>;
export declare const zoteroSemanticModelStatusRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    modelDir: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const zoteroSemanticModelStatusResultSchema: z.ZodObject<{
    model: z.ZodString;
    ready: z.ZodBoolean;
    downloading: z.ZodBoolean;
    path: z.ZodString;
    downloadedBytes: z.ZodNumber;
    totalBytes: z.ZodNumber;
    percent: z.ZodNumber;
    currentFile: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    warning: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const zoteroSemanticModelDownloadRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    source: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    modelDir: z.ZodOptional<z.ZodString>;
    force: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const zoteroSemanticModelDownloadResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    model: z.ZodString;
    status: z.ZodUnion<readonly [z.ZodLiteral<"started">, z.ZodLiteral<"already-ready">, z.ZodLiteral<"downloading">]>;
    path: z.ZodString;
}, z.core.$strict>;
export declare const zoteroSemanticModelCancelRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    modelDir: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const zoteroSemanticModelCancelResultSchema: z.ZodObject<{
    cancelled: z.ZodBoolean;
}, z.core.$strict>;
export declare const zoteroSemanticModelDeleteRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    modelDir: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const zoteroSemanticModelDeleteResultSchema: z.ZodObject<{
    success: z.ZodBoolean;
    model: z.ZodString;
    path: z.ZodString;
    removed: z.ZodBoolean;
    removedFiles: z.ZodNumber;
    removedBytes: z.ZodNumber;
}, z.core.$strict>;
export declare const zoteroSemanticModelVerifyRequestSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodEnum<{
        [x: string]: string;
    }>>;
    modelDir: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const zoteroParseTargetSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"attachment">;
    ref: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"url">;
    url: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"artifact">;
    artifactId: z.ZodString;
}, z.core.$strict>], "kind">;
export declare const zoteroStartDocumentParseRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    operationId: z.ZodUUID;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"attachment">;
        ref: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"url">;
        url: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact">;
        artifactId: z.ZodString;
    }, z.core.$strict>], "kind">;
    action: z.ZodEnum<{
        parse: "parse";
        reparse: "reparse";
        retry: "retry";
    }>;
}, z.core.$strict>;
export declare const zoteroParseReceiptSchema: z.ZodObject<{
    operationId: z.ZodUUID;
    generation: z.ZodUUID;
    sourceId: z.ZodString;
    targetLabel: z.ZodString;
    mode: z.ZodEnum<{
        free: "free";
        pro: "pro";
    }>;
    cached: z.ZodBoolean;
    artifactId: z.ZodString;
    fingerprint: z.ZodString;
    format: z.ZodLiteral<"markdown">;
    characterCount: z.ZodNumber;
    preview: z.ZodString;
    pageCount: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const zoteroStartDocumentParseResultSchema: z.ZodObject<{
    operationId: z.ZodUUID;
    generation: z.ZodUUID;
    jobId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        joined: "joined";
        started: "started";
    }>;
    receipt: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodUUID;
        generation: z.ZodUUID;
        sourceId: z.ZodString;
        targetLabel: z.ZodString;
        mode: z.ZodEnum<{
            free: "free";
            pro: "pro";
        }>;
        cached: z.ZodBoolean;
        artifactId: z.ZodString;
        fingerprint: z.ZodString;
        format: z.ZodLiteral<"markdown">;
        characterCount: z.ZodNumber;
        preview: z.ZodString;
        pageCount: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const zoteroDocumentArtifactRequestSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"inspect">;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"attachment">;
        ref: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"url">;
        url: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact">;
        artifactId: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"open">;
    requestId: z.ZodUUID;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"attachment">;
        ref: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"url">;
        url: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact">;
        artifactId: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"page">;
    lease: z.ZodUUID;
    offset: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"image">;
    lease: z.ZodUUID;
    name: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"release">;
    requestId: z.ZodUUID;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"meta">;
    target: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"attachment">;
        ref: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"url">;
        url: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"artifact">;
        artifactId: z.ZodString;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>, z.ZodObject<{
    sessionId: z.ZodString;
    op: z.ZodLiteral<"probe">;
    refs: z.ZodArray<z.ZodString>;
}, z.core.$strict>], "op">;
export declare const zoteroDocumentArtifactResultSchema: z.ZodUnion<readonly [z.ZodObject<{
    kind: z.ZodEnum<{
        expired: "expired";
        missing: "missing";
    }>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"released">;
}, z.core.$strict>, z.ZodObject<{
    sourceId: z.ZodString;
    targetLabel: z.ZodString;
    mode: z.ZodEnum<{
        free: "free";
        pro: "pro";
    }>;
    artifactId: z.ZodString;
    fingerprint: z.ZodString;
    characterCount: z.ZodNumber;
    pageCount: z.ZodOptional<z.ZodNumber>;
    images: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        mediaType: z.ZodEnum<{
            "image/bmp": "image/bmp";
            "image/gif": "image/gif";
            "image/jpeg": "image/jpeg";
            "image/png": "image/png";
            "image/webp": "image/webp";
        }>;
        bytes: z.ZodNumber;
    }, z.core.$strict>>;
    title: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"ready">;
}, z.core.$strict>, z.ZodObject<{
    sourceId: z.ZodString;
    targetLabel: z.ZodString;
    mode: z.ZodEnum<{
        free: "free";
        pro: "pro";
    }>;
    artifactId: z.ZodString;
    fingerprint: z.ZodString;
    characterCount: z.ZodNumber;
    pageCount: z.ZodOptional<z.ZodNumber>;
    images: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        mediaType: z.ZodEnum<{
            "image/bmp": "image/bmp";
            "image/gif": "image/gif";
            "image/jpeg": "image/jpeg";
            "image/png": "image/png";
            "image/webp": "image/webp";
        }>;
        bytes: z.ZodNumber;
    }, z.core.$strict>>;
    title: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"meta">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"probed">;
    results: z.ZodArray<z.ZodObject<{
        ref: z.ZodString;
        state: z.ZodEnum<{
            expired: "expired";
            missing: "missing";
            ready: "ready";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    sourceId: z.ZodString;
    targetLabel: z.ZodString;
    mode: z.ZodEnum<{
        free: "free";
        pro: "pro";
    }>;
    artifactId: z.ZodString;
    fingerprint: z.ZodString;
    characterCount: z.ZodNumber;
    pageCount: z.ZodOptional<z.ZodNumber>;
    images: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        mediaType: z.ZodEnum<{
            "image/bmp": "image/bmp";
            "image/gif": "image/gif";
            "image/jpeg": "image/jpeg";
            "image/png": "image/png";
            "image/webp": "image/webp";
        }>;
        bytes: z.ZodNumber;
    }, z.core.$strict>>;
    title: z.ZodOptional<z.ZodString>;
    kind: z.ZodLiteral<"opened">;
    lease: z.ZodUUID;
    expiresAt: z.ZodNumber;
    policy: z.ZodObject<{
        maxOpen: z.ZodNumber;
        maxBytes: z.ZodNumber;
        preparedMaxBytes: z.ZodNumber;
        idleTimeoutMs: z.ZodNumber;
        maxLifetimeMs: z.ZodNumber;
        concurrency: z.ZodNumber;
        archiveConcurrency: z.ZodNumber;
        archiveQueueLimit: z.ZodNumber;
    }, z.core.$strict>;
    page: z.ZodObject<{
        offset: z.ZodNumber;
        text: z.ZodString;
        totalChars: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"page">;
    lease: z.ZodUUID;
    artifactId: z.ZodString;
    page: z.ZodObject<{
        offset: z.ZodNumber;
        text: z.ZodString;
        totalChars: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"image">;
    lease: z.ZodUUID;
    artifactId: z.ZodString;
    name: z.ZodString;
    mediaType: z.ZodEnum<{
        "image/bmp": "image/bmp";
        "image/gif": "image/gif";
        "image/jpeg": "image/jpeg";
        "image/png": "image/png";
        "image/webp": "image/webp";
    }>;
    base64: z.ZodString;
}, z.core.$strict>]>;
export declare const zoteroDocumentParseReceiptRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    operationId: z.ZodUUID;
}, z.core.$strict>;
export declare const zoteroDocumentParseReceiptResultSchema: z.ZodUnion<readonly [z.ZodObject<{
    kind: z.ZodLiteral<"pending">;
    jobId: z.ZodString;
    generation: z.ZodUUID;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"completed">;
    receipt: z.ZodObject<{
        operationId: z.ZodUUID;
        generation: z.ZodUUID;
        sourceId: z.ZodString;
        targetLabel: z.ZodString;
        mode: z.ZodEnum<{
            free: "free";
            pro: "pro";
        }>;
        cached: z.ZodBoolean;
        artifactId: z.ZodString;
        fingerprint: z.ZodString;
        format: z.ZodLiteral<"markdown">;
        characterCount: z.ZodNumber;
        preview: z.ZodString;
        pageCount: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodEnum<{
        cancelled: "cancelled";
        failed: "failed";
    }>;
    code: z.ZodString;
    message: z.ZodString;
}, z.core.$strict>]>;
export declare const zoteroListParsedDocumentsRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    state: z.ZodOptional<z.ZodEnum<{
        broken: "broken";
        indexed: "indexed";
        orphan: "orphan";
    }>>;
    query: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const zoteroListParsedDocumentsResultSchema: z.ZodObject<{
    rows: z.ZodArray<z.ZodObject<{
        artifactId: z.ZodString;
        state: z.ZodEnum<{
            broken: "broken";
            indexed: "indexed";
            orphan: "orphan";
        }>;
        sourceKind: z.ZodEnum<{
            attachment: "attachment";
            url: "url";
        }>;
        title: z.ZodOptional<z.ZodString>;
        targetLabel: z.ZodString;
        mode: z.ZodEnum<{
            free: "free";
            pro: "pro";
        }>;
        generation: z.ZodUnion<[z.ZodUUID, z.ZodLiteral<"">]>;
        fingerprint: z.ZodUnion<[z.ZodString, z.ZodLiteral<"">]>;
        characterCount: z.ZodNumber;
        pageCount: z.ZodOptional<z.ZodNumber>;
        images: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            mediaType: z.ZodEnum<{
                "image/bmp": "image/bmp";
                "image/gif": "image/gif";
                "image/jpeg": "image/jpeg";
                "image/png": "image/png";
                "image/webp": "image/webp";
            }>;
            bytes: z.ZodNumber;
        }, z.core.$strict>>;
        markdownBytes: z.ZodNumber;
        committedAt: z.ZodNumber;
        aliases: z.ZodArray<z.ZodString>;
        broken: z.ZodOptional<z.ZodObject<{
            code: z.ZodEnum<{
                "missing-meta": "missing-meta";
                "unreadable-meta": "unreadable-meta";
            }>;
            detail: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        actionable: z.ZodBoolean;
    }, z.core.$strict>>;
    total: z.ZodNumber;
}, z.core.$strict>;
export declare const zoteroDiscardParsedDocumentRequestSchema: z.ZodObject<{
    sessionId: z.ZodString;
    artifactId: z.ZodString;
}, z.core.$strict>;
export declare const zoteroDiscardParsedDocumentResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"missing">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"discarded">;
    removedAliases: z.ZodNumber;
    removedReceipts: z.ZodNumber;
}, z.core.$strict>], "kind">;
export declare const ZOTERO_COMMON_INVOCATIONS: readonly InvocationDescriptor[];
//# sourceMappingURL=wire-schemas.d.ts.map