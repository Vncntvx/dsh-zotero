/**
 * The `zotero_children` tool: explore the Zotero object graph. An item ref
 * yields direct notes/attachments from bare `/children` plus, when
 * requested, annotations under the item via `/children?itemType=annotation`;
 * an attachment ref yields its own annotations through that filtered
 * listing. Counterpart to `zotero_get` (one object's detail) — use it when
 * the model needs to walk structure rather than read metadata.
 * @module dsh-zotero/tools/children
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const CHILDREN_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY>, zotero://user/0/attachment/<KEY> (or group form) ref from a previous tool result.";
    };
    readonly include: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
            readonly enum: readonly ["notes", "attachments", "annotations"];
        };
        readonly description: "Child kinds to return; omitted returns all three. Direct notes/attachments come from bare /children; annotations from /children?itemType=annotation (Zotero stores them under PDF attachments, and a bare listing never returns them). Attachment refs yield their annotations via that filtered read.";
    };
};
type ChildrenArgs = InferArgs<typeof CHILDREN_PARAMETERS>;
declare const CHILDREN_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ref: {
            readonly type: "string";
            readonly required: true;
        };
        readonly itemType: {
            readonly type: "string";
        };
        readonly serverId: {
            readonly type: "string";
        };
        readonly notes: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly total: {
                    readonly type: "integer";
                    readonly required: true;
                };
                readonly returned: {
                    readonly type: "integer";
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
                };
            };
        };
        readonly annotations: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly total: {
                    readonly type: "integer";
                    readonly required: true;
                };
                readonly returned: {
                    readonly type: "integer";
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
                };
            };
        };
        readonly attachments: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly total: {
                    readonly type: "integer";
                    readonly required: true;
                };
                readonly returned: {
                    readonly type: "integer";
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
                            readonly contentType: {
                                readonly type: "string";
                                readonly required: true;
                            };
                            readonly linkMode: {
                                readonly type: "string";
                            };
                        };
                    };
                };
            };
        };
    };
};
type ChildrenOutput = InferValue<typeof CHILDREN_OUTPUT_SCHEMA>;
/** The model-facing message for an explicit empty include list. */
export declare const CHILDREN_INCLUDE_EMPTY_MESSAGE = "include must list at least one child kind when provided";
/** The model-facing message for a call that asked for no child kind. */
export declare const CHILDREN_NONE_REQUESTED_MESSAGE = "No child kinds requested.";
export declare function renderChildren(_args: ChildrenArgs, value: ChildrenOutput): ContentBlock[];
export declare function registerChildrenTool(ctx: Context, service: ZoteroService): void;
export {};
//# sourceMappingURL=children.d.ts.map