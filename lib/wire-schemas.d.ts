/**
 * The wire boundary schemas both codec arms materialize. The host registry
 * (`src/status-codec.ts`) parses payloads with them through `create()`, and
 * the browser arm (`src/client/status-codec.ts`) carries the same objects.
 * Neither half imports the other's module.
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
import type { TypertCodec } from '@deepseek-ai/dsh-typert-protocol';
import type { ZoteroChildRowsView } from './contract.js';
/**
 * The panel's sort fields, derived from the domain's one array so the two
 * cannot drift (`tests/unit/wire-schemas.spec.ts` additionally pins the
 * exact order).
 */
export declare const zoteroLibrarySortSchema: z.ZodEnum<{
    dateModified: "dateModified";
    dateAdded: "dateAdded";
    date: "date";
    title: "title";
    creator: "creator";
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
export declare function strictCodec(typeSymbol: string, schema: z.ZodType): TypertCodec;
/** Wire schema: one status view (strict; absent optional facts stay absent). */
export declare const zoteroStatusSchema: z.ZodReadonly<z.ZodObject<{
    providerId: z.ZodString;
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
/** Wire schema: one diagnostics snapshot (strict; the ring pre-strips absent optionals). */
export declare const zoteroDiagnosticsSchema: z.ZodReadonly<z.ZodObject<{
    entries: z.ZodReadonly<z.ZodArray<z.ZodReadonly<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodNumber;
        level: z.ZodEnum<{
            debug: "debug";
            info: "info";
            warn: "warn";
            error: "error";
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
    ok: z.ZodBoolean;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
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
        savedSearches: "savedSearches";
        tags: "tags";
        libraries: "libraries";
        itemTypes: "itemTypes";
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
        savedSearches: "savedSearches";
        tags: "tags";
        libraries: "libraries";
        itemTypes: "itemTypes";
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
    cacheGeneration: z.ZodOptional<z.ZodNumber>;
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
        metadata: "metadata";
        everything: "everything";
    }>>;
    sort: z.ZodEnum<{
        dateModified: "dateModified";
        dateAdded: "dateAdded";
        date: "date";
        title: "title";
        creator: "creator";
    }>;
    direction: z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>;
    offset: z.ZodNumber;
    limit: z.ZodNumber;
    itemLevel: z.ZodOptional<z.ZodEnum<{
        top: "top";
        all: "all";
    }>>;
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
        notes: "notes";
        attachments: "attachments";
        annotations: "annotations";
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
        notes: "notes";
        attachments: "attachments";
        annotations: "annotations";
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
    citation: "citation";
    bibliography: "bibliography";
    bibtex: "bibtex";
    biblatex: "biblatex";
    ris: "ris";
    csljson: "csljson";
}>;
/** Wire schema: the translator export formats, derived from the sibling array. */
export declare const zoteroLibraryTranslatorExportFormatSchema: z.ZodEnum<{
    bibtex: "bibtex";
    biblatex: "biblatex";
    ris: "ris";
    csljson: "csljson";
}>;
/**
 * Wire schema: library export request. The refs bound is Zotero's own
 * `itemKey` per-request cap — the configured `maxExportRefs` gate runs in the
 * host service, where the live config is read.
 */
export declare const zoteroLibraryExportRequestSchema: z.ZodReadonly<z.ZodObject<{
    refs: z.ZodReadonly<z.ZodArray<z.ZodString>>;
    format: z.ZodEnum<{
        citation: "citation";
        bibliography: "bibliography";
        bibtex: "bibtex";
        biblatex: "biblatex";
        ris: "ris";
        csljson: "csljson";
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
        bibtex: "bibtex";
        biblatex: "biblatex";
        ris: "ris";
        csljson: "csljson";
    }>;
    style: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
    text: z.ZodString;
}, z.core.$strict>>], "format">>;
/**
 * Closed panel mutation union. Extra or malformed nested fields are rejected
 * at the gateway. `satisfies` pins the schema's output to the hand-written
 * `ZoteroLibraryWriteRequestView`, so drift between the two fails at compile
 * time.
 */
export declare const zoteroLibraryWriteRequestSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"updateTags">;
    args: z.ZodObject<{
        ref: z.ZodString;
        add: z.ZodOptional<z.ZodArray<z.ZodString>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"updateMembership">;
    args: z.ZodObject<{
        ref: z.ZodString;
        add: z.ZodOptional<z.ZodArray<z.ZodString>>;
        remove: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
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
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"createNote">;
    args: z.ZodObject<{
        markdown: z.ZodString;
        parentItem: z.ZodOptional<z.ZodString>;
        collections: z.ZodOptional<z.ZodArray<z.ZodString>>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        sourceRefs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"updateNote">;
    args: z.ZodObject<{
        ref: z.ZodString;
        markdown: z.ZodString;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"createCollection">;
    args: z.ZodObject<{
        name: z.ZodString;
        parent: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"updateCollection">;
    args: z.ZodObject<{
        collection: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        parent: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"deleteCollection">;
    args: z.ZodObject<{
        collection: z.ZodString;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"createSavedSearch">;
    args: z.ZodObject<{
        name: z.ZodString;
        conditions: z.ZodArray<z.ZodObject<{
            condition: z.ZodString;
            operator: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
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
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"deleteSavedSearch">;
    args: z.ZodObject<{
        search: z.ZodString;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"trash">;
    args: z.ZodObject<{
        refs: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    operation: z.ZodLiteral<"restore">;
    args: z.ZodObject<{
        refs: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    sessionId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
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
    sessionId: z.ZodString;
}, z.core.$strict>], "operation">;
export declare const zoteroLibraryWriteResultSchema: z.ZodReadonly<z.ZodObject<{
    kind: z.ZodEnum<{
        applied: "applied";
        declined: "declined";
        "committed-unverified": "committed-unverified";
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
//# sourceMappingURL=wire-schemas.d.ts.map