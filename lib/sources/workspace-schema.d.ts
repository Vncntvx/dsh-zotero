/** Strict source workspace schemas shared by Remote boundaries. */
import { z } from 'zod';
import type { FulltextRead } from './model.js';
declare const fulltextReadSchema: z.ZodLazy<z.ZodObject<{
    sourceKind: z.ZodEnum<{
        attachment: "attachment";
        url: "url";
    }>;
    sourceLabel: z.ZodString;
    item: z.ZodOptional<z.ZodObject<{
        ref: z.ZodString;
        title: z.ZodString;
        creatorSummary: z.ZodString;
        year: z.ZodOptional<z.ZodNumber>;
        venue: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    attachmentContentType: z.ZodOptional<z.ZodString>;
    textFormat: z.ZodEnum<{
        markdown: "markdown";
        text: "text";
    }>;
    artifact: z.ZodOptional<z.ZodLazy<z.ZodObject<{
        parser: z.ZodLiteral<"mineru">;
        mode: z.ZodEnum<{
            free: "free";
            pro: "pro";
        }>;
        artifactId: z.ZodString;
        fingerprint: z.ZodString;
        sourceId: z.ZodString;
        generation: z.ZodString;
    }, z.core.$strict>>>;
    coverage: z.ZodOptional<z.ZodLazy<z.ZodObject<{
        indexedPages: z.ZodOptional<z.ZodNumber>;
        totalPages: z.ZodOptional<z.ZodNumber>;
        indexedChars: z.ZodOptional<z.ZodNumber>;
        totalChars: z.ZodOptional<z.ZodNumber>;
        complete: z.ZodBoolean;
    }, z.core.$strict>>>;
    totalChars: z.ZodNumber;
    inputTruncated: z.ZodBoolean;
    start: z.ZodNumber;
    end: z.ZodNumber;
    isTruncated: z.ZodBoolean;
    spillAvailable: z.ZodBoolean;
    attachmentRef: z.ZodOptional<z.ZodString>;
    callIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>>;
/**
 * Compile-time tie between the trail model and this wire schema. A field the
 * model produces and the schema omits makes every row carrying it unparseable
 * at the projection boundary, so the omission is a type error here instead of
 * a runtime rejection later. Removing the field from the schema, or adding one
 * to {@link FulltextRead} without adding it above, flips this to `false`.
 * The export is the usage: the conditional type is evaluated because the
 * declaration is exported.
 */
export declare const FULLTEXT_READ_SCHEMA_MATCHES_MODEL: Exclude<keyof FulltextRead, keyof z.infer<typeof fulltextReadSchema>> extends never ? true : false;
export declare const sourceWorkspaceSchema: z.ZodLazy<z.ZodObject<{
    detailsDeferred: z.ZodOptional<z.ZodLiteral<true>>;
    detailsRevision: z.ZodOptional<z.ZodNumber>;
    sources: z.ZodArray<z.ZodLazy<z.ZodObject<{
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
        operations: z.ZodLazy<z.ZodObject<{
            running: z.ZodNumber;
            failed: z.ZodNumber;
            stopped: z.ZodNumber;
        }, z.core.$strict>>;
        searches: z.ZodArray<z.ZodLazy<z.ZodObject<{
            callId: z.ZodString;
            query: z.ZodOptional<z.ZodString>;
            mode: z.ZodEnum<{
                everything: "everything";
                metadata: "metadata";
            }>;
            itemLevel: z.ZodEnum<{
                all: "all";
                top: "top";
            }>;
            scope: z.ZodLazy<z.ZodUnion<readonly [z.ZodObject<{
                kind: z.ZodLiteral<"library">;
                library: z.ZodOptional<z.ZodLazy<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"user">;
                    id: z.ZodLiteral<0>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"group">;
                    id: z.ZodNumber;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"publications">;
                library: z.ZodOptional<z.ZodLazy<z.ZodUnion<readonly [z.ZodObject<{
                    type: z.ZodLiteral<"user">;
                    id: z.ZodLiteral<0>;
                }, z.core.$strict>, z.ZodObject<{
                    type: z.ZodLiteral<"group">;
                    id: z.ZodNumber;
                }, z.core.$strict>]>>>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"collection">;
                ref: z.ZodOptional<z.ZodString>;
                name: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"savedSearch">;
                ref: z.ZodOptional<z.ZodString>;
                name: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>]>>;
            library: z.ZodOptional<z.ZodLazy<z.ZodUnion<readonly [z.ZodObject<{
                type: z.ZodLiteral<"user">;
                id: z.ZodLiteral<0>;
            }, z.core.$strict>, z.ZodObject<{
                type: z.ZodLiteral<"group">;
                id: z.ZodNumber;
            }, z.core.$strict>]>>>;
            itemTypes: z.ZodArray<z.ZodString>;
            tags: z.ZodArray<z.ZodString>;
            tagMatch: z.ZodOptional<z.ZodEnum<{
                all: "all";
                any: "any";
            }>>;
            excludeTags: z.ZodArray<z.ZodString>;
            returned: z.ZodNumber;
            total: z.ZodOptional<z.ZodNumber>;
            noteMatches: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>>;
        searchesTotal: z.ZodNumber;
        evidence: z.ZodArray<z.ZodLazy<z.ZodObject<{
            source: z.ZodString;
            sourceRef: z.ZodString;
            text: z.ZodString;
            previewTruncated: z.ZodBoolean;
            textFormat: z.ZodOptional<z.ZodEnum<{
                markdown: "markdown";
                text: "text";
            }>>;
            artifact: z.ZodOptional<z.ZodLazy<z.ZodObject<{
                parser: z.ZodLiteral<"mineru">;
                mode: z.ZodEnum<{
                    free: "free";
                    pro: "pro";
                }>;
                artifactId: z.ZodString;
                fingerprint: z.ZodString;
                sourceId: z.ZodString;
                generation: z.ZodString;
            }, z.core.$strict>>>;
            start: z.ZodOptional<z.ZodNumber>;
            end: z.ZodOptional<z.ZodNumber>;
            pageLabel: z.ZodOptional<z.ZodString>;
            attachmentRef: z.ZodOptional<z.ZodString>;
            matchKind: z.ZodOptional<z.ZodEnum<{
                hybrid: "hybrid";
                lexical: "lexical";
                semantic: "semantic";
            }>>;
            matchedFields: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                comment: "comment";
                text: "text";
            }>>>;
            callIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        evidenceTotal: z.ZodNumber;
        fulltextReads: z.ZodArray<z.ZodLazy<z.ZodObject<{
            sourceKind: z.ZodEnum<{
                attachment: "attachment";
                url: "url";
            }>;
            sourceLabel: z.ZodString;
            item: z.ZodOptional<z.ZodObject<{
                ref: z.ZodString;
                title: z.ZodString;
                creatorSummary: z.ZodString;
                year: z.ZodOptional<z.ZodNumber>;
                venue: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            attachmentContentType: z.ZodOptional<z.ZodString>;
            textFormat: z.ZodEnum<{
                markdown: "markdown";
                text: "text";
            }>;
            artifact: z.ZodOptional<z.ZodLazy<z.ZodObject<{
                parser: z.ZodLiteral<"mineru">;
                mode: z.ZodEnum<{
                    free: "free";
                    pro: "pro";
                }>;
                artifactId: z.ZodString;
                fingerprint: z.ZodString;
                sourceId: z.ZodString;
                generation: z.ZodString;
            }, z.core.$strict>>>;
            coverage: z.ZodOptional<z.ZodLazy<z.ZodObject<{
                indexedPages: z.ZodOptional<z.ZodNumber>;
                totalPages: z.ZodOptional<z.ZodNumber>;
                indexedChars: z.ZodOptional<z.ZodNumber>;
                totalChars: z.ZodOptional<z.ZodNumber>;
                complete: z.ZodBoolean;
            }, z.core.$strict>>>;
            totalChars: z.ZodNumber;
            inputTruncated: z.ZodBoolean;
            start: z.ZodNumber;
            end: z.ZodNumber;
            isTruncated: z.ZodBoolean;
            spillAvailable: z.ZodBoolean;
            attachmentRef: z.ZodOptional<z.ZodString>;
            callIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        fulltextReadsTotal: z.ZodNumber;
        bestAttachment: z.ZodOptional<z.ZodLazy<z.ZodObject<{
            ref: z.ZodOptional<z.ZodString>;
            contentType: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        readAttachment: z.ZodOptional<z.ZodLazy<z.ZodObject<{
            ref: z.ZodOptional<z.ZodString>;
            contentType: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        attachment: z.ZodOptional<z.ZodLazy<z.ZodObject<{
            ref: z.ZodOptional<z.ZodString>;
            kind: z.ZodEnum<{
                file: "file";
                url: "url";
            }>;
            contentType: z.ZodString;
            title: z.ZodString;
            location: z.ZodString;
        }, z.core.$strict>>>;
        retrievalFacts: z.ZodOptional<z.ZodLazy<z.ZodObject<{
            attachmentRef: z.ZodOptional<z.ZodString>;
            attachmentContentType: z.ZodOptional<z.ZodString>;
            coverage: z.ZodOptional<z.ZodLazy<z.ZodObject<{
                indexedPages: z.ZodOptional<z.ZodNumber>;
                totalPages: z.ZodOptional<z.ZodNumber>;
                indexedChars: z.ZodOptional<z.ZodNumber>;
                totalChars: z.ZodOptional<z.ZodNumber>;
                complete: z.ZodBoolean;
            }, z.core.$strict>>>;
            truncated: z.ZodBoolean;
            sourceAvailability: z.ZodRecord<z.ZodString, z.ZodLazy<z.ZodObject<{
                requested: z.ZodBoolean;
                returnedPassages: z.ZodNumber;
                unavailable: z.ZodBoolean;
            }, z.core.$strict>>>;
        }, z.core.$strict>>>;
        retrievalSummary: z.ZodOptional<z.ZodLazy<z.ZodObject<{
            runCount: z.ZodNumber;
            truncated: z.ZodBoolean;
        }, z.core.$strict>>>;
        exports: z.ZodArray<z.ZodLazy<z.ZodObject<{
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
            items: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodUnion<readonly [z.ZodObject<{
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
            }, z.core.$strict>, z.ZodObject<{
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
                start: z.ZodNumber;
                end: z.ZodNumber;
            }, z.core.$strict>]>>>>;
            text: z.ZodString;
        }, z.core.$strict>>>;
        exportsTotal: z.ZodNumber;
        firstSeenAt: z.ZodNumber;
        lastTouchedAt: z.ZodNumber;
    }, z.core.$strict>>>;
    sourceTotal: z.ZodNumber;
    exports: z.ZodArray<z.ZodLazy<z.ZodObject<{
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
        items: z.ZodOptional<z.ZodArray<z.ZodLazy<z.ZodUnion<readonly [z.ZodObject<{
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
        }, z.core.$strict>, z.ZodObject<{
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
            start: z.ZodNumber;
            end: z.ZodNumber;
        }, z.core.$strict>]>>>>;
        text: z.ZodString;
    }, z.core.$strict>>>;
    exportTotal: z.ZodNumber;
    exportOperations: z.ZodLazy<z.ZodObject<{
        running: z.ZodNumber;
        failed: z.ZodNumber;
        stopped: z.ZodNumber;
    }, z.core.$strict>>;
    searchOperations: z.ZodLazy<z.ZodObject<{
        running: z.ZodNumber;
        failed: z.ZodNumber;
        stopped: z.ZodNumber;
    }, z.core.$strict>>;
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
}, z.core.$strict>>;
export {};
//# sourceMappingURL=workspace-schema.d.ts.map