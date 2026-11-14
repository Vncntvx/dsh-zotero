/** Strict source workspace schemas shared by Remote boundaries. */
import { z } from 'zod';
export declare const sourceItemSchema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const sourceWorkspaceSchema: z.ZodObject<{
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
//# sourceMappingURL=workspace-schema.d.ts.map