/**
 * Shared child-object record schemas for the model contract.
 *
 * `zotero_get` (detail includes) and `zotero_children` (graph walk) serve the
 * same three shapes — note, annotation, attachment — and the output schema is
 * the model contract, so a drift between the two files would fork the
 * contract. A single source keeps them identical by construction.
 * @module dsh-zotero/tools/child-records
 */
/** One child note row: ref, text, truncation flag, and optional parent. */
export declare const NOTE_RECORD: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ref: {
            readonly type: "string";
            readonly required: true;
        };
        readonly text: {
            readonly type: "string";
            readonly required: true;
        };
        readonly truncated: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly parentRef: {
            readonly type: "string";
        };
    };
};
/** One annotation row: type/text plus the annotator's own view fields. */
export declare const ANNOTATION_RECORD: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ref: {
            readonly type: "string";
            readonly required: true;
        };
        readonly type: {
            readonly type: "string";
            readonly required: true;
        };
        readonly text: {
            readonly type: "string";
            readonly required: true;
        };
        readonly comment: {
            readonly type: "string";
        };
        readonly color: {
            readonly type: "string";
        };
        readonly pageLabel: {
            readonly type: "string";
        };
        readonly parentRef: {
            readonly type: "string";
        };
    };
};
/** One attachment row: identity, title, content type, and link mode. */
export declare const ATTACHMENT_RECORD: {
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
        readonly contentType: {
            readonly type: "string";
            readonly required: true;
        };
        readonly linkMode: {
            readonly type: "string";
        };
    };
};
//# sourceMappingURL=child-records.d.ts.map