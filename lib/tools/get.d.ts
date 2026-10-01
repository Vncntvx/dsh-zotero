/**
 * The `zotero_get` tool: read one item's metadata, with child notes,
 * annotations, and attachments included on request. The default call is a
 * single request; any include reads the bare `/children` listing
 * (notes/attachments), and an annotations include adds the
 * `?itemType=annotation` listing — the Local API never returns annotations
 * from the bare children endpoint. Ref provenance is checked by the provider.
 * @module dsh-zotero/tools/get
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const GET_PARAMETERS: {
    readonly ref: {
        readonly type: "string";
        readonly required: true;
        readonly description: "A zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY> ref from zotero_search or a previous tool result.";
    };
    readonly include: {
        readonly type: "array";
        readonly items: {
            readonly type: "string";
            readonly enum: readonly ["notes", "annotations", "attachments"];
        };
        readonly description: "Child content kinds to include. Omit for metadata only. notes/attachments read the bare /children listing; annotations add /children?itemType=annotation (a bare listing never returns annotations).";
    };
    readonly fields: {
        readonly type: "string";
        readonly enum: readonly ["standard", "all"];
        readonly description: "standard (default) returns the normalized model; all additionally returns extraFields — every data field the model does not consume (repository, archive, number-of-pages, …), so special item types keep their metadata.";
    };
};
type GetArgs = InferArgs<typeof GET_PARAMETERS>;
declare const GET_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ref: {
            readonly type: "string";
            readonly required: true;
        };
        readonly itemType: {
            readonly type: "string";
            readonly required: true;
        };
        readonly title: {
            readonly type: "string";
            readonly required: true;
        };
        readonly creators: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly creatorType: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly name: {
                        readonly type: "string";
                    };
                    readonly firstName: {
                        readonly type: "string";
                    };
                    readonly lastName: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly extra: {
            readonly type: "string";
        };
        readonly date: {
            readonly type: "string";
        };
        readonly year: {
            readonly type: "integer";
        };
        readonly venue: {
            readonly type: "string";
        };
        readonly doi: {
            readonly type: "string";
        };
        readonly url: {
            readonly type: "string";
        };
        readonly abstract: {
            readonly type: "string";
        };
        readonly abstractTruncated: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly noteBody: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly properties: {
                readonly text: {
                    readonly type: "string";
                    readonly required: true;
                };
                readonly truncated: {
                    readonly type: "boolean";
                    readonly required: true;
                };
            };
        };
        readonly tags: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly type: "string";
            };
        };
        readonly collections: {
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
                    readonly name: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly children: {
            readonly type: "object";
            readonly additionalProperties: false;
            readonly required: true;
            readonly properties: {
                readonly total: {
                    readonly type: "integer";
                    readonly required: true;
                };
            };
        };
        readonly bestAttachment: {
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
        readonly relations: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly predicate: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly targetUri: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly targetRef: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly version: {
            readonly type: "integer";
        };
        readonly serverId: {
            readonly type: "string";
        };
        readonly extraFields: {
            readonly type: "object";
            readonly additionalProperties: true;
        };
    };
};
type GetOutput = InferValue<typeof GET_OUTPUT_SCHEMA>;
export declare function renderGet(_args: GetArgs, value: GetOutput): ContentBlock[];
export declare function registerGetTool(ctx: Context, service: ZoteroService): void;
export {};
//# sourceMappingURL=get.d.ts.map