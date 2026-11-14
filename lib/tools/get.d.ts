/**
 * The `zotero_get` tool: read one item's metadata, with child notes,
 * annotations, and attachments included on request. The default call is a
 * single request; a notes or attachments include reads the bare `/children`
 * listing, and an annotations include adds the `?itemType=annotation`
 * listing, because the Local API never returns annotations from the bare children
 * endpoint, so an annotations-only include reads no bare listing. Ref
 * provenance is checked by the provider.
 * @module dsh-zotero/tools/get
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import { type ToolWrapper } from '../result-delivery.js';
import type { ZoteroService } from '../service.js';
declare const GET_PARAMETERS: {
    readonly locations: {
        readonly type: 'string';
        readonly enum: readonly ['none', 'best', 'included'];
        readonly description: 'none (default), best attachment, or included attachments; included requires include attachments.';
    };
    readonly childPages: {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly properties: {
            readonly notes: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly offset: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                    readonly limit: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                };
            };
            readonly annotations: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly offset: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                    readonly limit: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                };
            };
            readonly attachments: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly offset: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                    readonly limit: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                };
            };
        };
        readonly description: 'Per-kind child windows (offset >= 0, limit 1–100); omitted windows read all requested children.';
    };
    readonly ref: {
        readonly type: 'string';
        readonly required: true;
        readonly description: "One zotero://user/0/item/<KEY> or zotero://group/<id>/item/<KEY> item or attachment ref. For multiple refs use zotero_get_batch.";
    };
    readonly include: {
        readonly type: 'array';
        readonly items: {
            readonly type: 'string';
            readonly enum: readonly ['notes', 'annotations', 'attachments'];
        };
        readonly description: 'Child kinds to include; omit for metadata only. Item annotations are read under PDF attachments.';
    };
    readonly fields: {
        readonly type: 'string';
        readonly enum: readonly ['standard', 'all'];
        readonly description: 'standard normalized fields; all also returns unconsumed Zotero data in extraFields.';
    };
};
type GetArgs = InferArgs<typeof GET_PARAMETERS>;
declare const GET_OUTPUT_SCHEMA: {
    readonly type: 'object';
    readonly additionalProperties: false;
    readonly properties: {
        readonly location: {
            readonly oneOf: readonly [{
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: 'string';
                        readonly const: 'file';
                        readonly required: true;
                    };
                    readonly path: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                };
            }, {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: 'string';
                        readonly const: 'url';
                        readonly required: true;
                    };
                    readonly url: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                };
            }, {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly kind: {
                        readonly type: 'string';
                        readonly const: 'unavailable';
                        readonly required: true;
                    };
                    readonly reason: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                };
            }];
        };
        readonly ref: {
            readonly type: 'string';
            readonly required: true;
        };
        readonly itemType: {
            readonly type: 'string';
            readonly required: true;
        };
        readonly title: {
            readonly type: 'string';
            readonly required: true;
        };
        readonly creators: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly creatorType: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly name: {
                        readonly type: 'string';
                    };
                    readonly firstName: {
                        readonly type: 'string';
                    };
                    readonly lastName: {
                        readonly type: 'string';
                    };
                };
            };
        };
        readonly extra: {
            readonly type: 'string';
        };
        readonly citationKey: {
            readonly type: 'string';
        };
        readonly citationKeySource: {
            readonly type: 'string';
            readonly enum: readonly ['native', 'extra'];
        };
        readonly citationKeyConflict: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly native: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly extra: {
                    readonly type: 'string';
                    readonly required: true;
                };
            };
        };
        readonly date: {
            readonly type: 'string';
        };
        readonly year: {
            readonly type: 'integer';
        };
        readonly venue: {
            readonly type: 'string';
        };
        readonly doi: {
            readonly type: 'string';
        };
        readonly url: {
            readonly type: 'string';
        };
        readonly abstract: {
            readonly type: 'string';
        };
        readonly abstractTruncated: {
            readonly type: 'boolean';
            readonly required: true;
        };
        readonly noteBody: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly text: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly truncated: {
                    readonly type: 'boolean';
                    readonly required: true;
                };
            };
        };
        readonly tags: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly type: 'string';
            };
        };
        readonly collections: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly ref: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly name: {
                        readonly type: 'string';
                    };
                };
            };
        };
        readonly children: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly required: true;
            readonly properties: {
                readonly total: {
                    readonly type: 'integer';
                    readonly required: true;
                };
            };
        };
        readonly bestAttachment: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly ref: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly title: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly contentType: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly location: {
                    readonly oneOf: readonly [{
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly kind: {
                                readonly type: 'string';
                                readonly const: 'file';
                                readonly required: true;
                            };
                            readonly path: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                        };
                    }, {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly kind: {
                                readonly type: 'string';
                                readonly const: 'url';
                                readonly required: true;
                            };
                            readonly url: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                        };
                    }, {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly kind: {
                                readonly type: 'string';
                                readonly const: 'unavailable';
                                readonly required: true;
                            };
                            readonly reason: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                        };
                    }];
                };
                readonly linkMode: {
                    readonly type: 'string';
                };
                readonly path: {
                    readonly type: 'string';
                };
                readonly url: {
                    readonly type: 'string';
                };
            };
        };
        readonly notes: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly completeness: {
                    readonly type: 'string';
                    readonly enum: readonly ['complete', 'page'];
                };
                readonly offset: {
                    readonly type: 'integer';
                };
                readonly limit: {
                    readonly type: 'integer';
                };
                readonly nextOffset: {
                    readonly type: 'integer';
                };
                readonly total: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly returned: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly items: {
                    readonly type: 'array';
                    readonly required: true;
                    readonly items: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly ref: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly text: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly truncated: {
                                readonly type: 'boolean';
                                readonly required: true;
                            };
                            readonly parentRef: {
                                readonly type: 'string';
                            };
                        };
                    };
                };
            };
        };
        readonly annotations: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly completeness: {
                    readonly type: 'string';
                    readonly enum: readonly ['complete', 'page'];
                };
                readonly offset: {
                    readonly type: 'integer';
                };
                readonly limit: {
                    readonly type: 'integer';
                };
                readonly nextOffset: {
                    readonly type: 'integer';
                };
                readonly total: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly returned: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly items: {
                    readonly type: 'array';
                    readonly required: true;
                    readonly items: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly ref: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly type: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly text: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly comment: {
                                readonly type: 'string';
                            };
                            readonly color: {
                                readonly type: 'string';
                            };
                            readonly pageLabel: {
                                readonly type: 'string';
                            };
                            readonly parentRef: {
                                readonly type: 'string';
                            };
                        };
                    };
                };
            };
        };
        readonly attachments: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly completeness: {
                    readonly type: 'string';
                    readonly enum: readonly ['complete', 'page'];
                };
                readonly offset: {
                    readonly type: 'integer';
                };
                readonly limit: {
                    readonly type: 'integer';
                };
                readonly nextOffset: {
                    readonly type: 'integer';
                };
                readonly total: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly returned: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly items: {
                    readonly type: 'array';
                    readonly required: true;
                    readonly items: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly ref: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly title: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly contentType: {
                                readonly type: 'string';
                                readonly required: true;
                            };
                            readonly location: {
                                readonly oneOf: readonly [{
                                    readonly type: 'object';
                                    readonly additionalProperties: false;
                                    readonly properties: {
                                        readonly kind: {
                                            readonly type: 'string';
                                            readonly const: 'file';
                                            readonly required: true;
                                        };
                                        readonly path: {
                                            readonly type: 'string';
                                            readonly required: true;
                                        };
                                    };
                                }, {
                                    readonly type: 'object';
                                    readonly additionalProperties: false;
                                    readonly properties: {
                                        readonly kind: {
                                            readonly type: 'string';
                                            readonly const: 'url';
                                            readonly required: true;
                                        };
                                        readonly url: {
                                            readonly type: 'string';
                                            readonly required: true;
                                        };
                                    };
                                }, {
                                    readonly type: 'object';
                                    readonly additionalProperties: false;
                                    readonly properties: {
                                        readonly kind: {
                                            readonly type: 'string';
                                            readonly const: 'unavailable';
                                            readonly required: true;
                                        };
                                        readonly reason: {
                                            readonly type: 'string';
                                            readonly required: true;
                                        };
                                    };
                                }];
                            };
                            readonly linkMode: {
                                readonly type: 'string';
                            };
                            readonly path: {
                                readonly type: 'string';
                            };
                            readonly url: {
                                readonly type: 'string';
                            };
                        };
                    };
                };
            };
        };
        readonly relations: {
            readonly type: 'array';
            readonly items: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly predicate: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly targetUri: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly targetRef: {
                        readonly type: 'string';
                    };
                };
            };
        };
        readonly version: {
            readonly type: 'integer';
        };
        readonly serverId: {
            readonly type: 'string';
        };
        readonly extraFields: {
            readonly type: 'object';
            readonly additionalProperties: true;
        };
        readonly path: {
            readonly type: 'string';
        };
        readonly contentType: {
            readonly type: 'string';
        };
    };
};
type GetOutput = InferValue<typeof GET_OUTPUT_SCHEMA>;
export declare const FILE_ENVIRONMENT_MESSAGE = "File environment: local filesystem or host mount (e.g. WSL /mnt/\u2026). A reader elsewhere (a sandbox without mounts, an isolated container, a remote host) may not see this path.";
export declare function renderGet(_args: GetArgs, value: GetOutput): ContentBlock[];
export declare function registerGetTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): void;
export {};
//# sourceMappingURL=get.d.ts.map