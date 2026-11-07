/** The `zotero_get_batch` tool: bounded metadata reads with isolated failures. */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import { type ToolWrapper } from '../result-delivery.js';
import type { ZoteroService } from '../service.js';
declare const PARAMETERS: {
    readonly refs: {
        readonly type: 'array';
        readonly required: true;
        readonly items: {
            readonly type: 'string';
        };
        readonly description: "Zotero item or attachment refs to read in order; 1–50, unique. Use this for multiple refs instead of repeated zotero_get calls.";
    };
    readonly fields: {
        readonly type: 'string';
        readonly enum: readonly ['standard', 'all'];
        readonly description: 'Metadata projection; all preserves unconsumed Zotero data fields.';
    };
    readonly include: {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly properties: {
            readonly children: {
                readonly type: 'boolean';
                readonly description: 'Include notes, annotations, and attachments.';
            };
            readonly attachments: {
                readonly type: 'boolean';
                readonly description: 'Include attachments.';
            };
            readonly relations: {
                readonly type: 'boolean';
                readonly description: 'Include item relations when available.';
            };
            readonly bestAttachment: {
                readonly type: 'boolean';
                readonly description: 'Resolve the best attachment location.';
            };
        };
    };
};
type Args = InferArgs<typeof PARAMETERS>;
type Output = InferValue<typeof OUTPUT>;
declare const OUTPUT: {
    readonly type: 'object';
    readonly additionalProperties: false;
    readonly properties: {
        readonly items: {
            readonly type: 'array';
            readonly required: true;
            readonly items: {
                readonly oneOf: readonly [{
                    readonly type: 'object';
                    readonly additionalProperties: true;
                    readonly properties: {
                        readonly ref: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly status: {
                            readonly type: 'string';
                            readonly const: 'ok';
                            readonly required: true;
                        };
                        readonly item: {
                            readonly type: 'object';
                            readonly additionalProperties: true;
                            readonly required: true;
                        };
                    };
                }, {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly ref: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly status: {
                            readonly type: 'string';
                            readonly const: 'error';
                            readonly required: true;
                        };
                        readonly code: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly message: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly next: {
                            readonly type: 'string';
                        };
                    };
                }];
            };
        };
        readonly counts: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly required: true;
            readonly properties: {
                readonly requested: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly succeeded: {
                    readonly type: 'integer';
                    readonly required: true;
                };
                readonly failed: {
                    readonly type: 'integer';
                    readonly required: true;
                };
            };
        };
    };
};
export declare function renderGetBatch(_args: Args, value: Output): ContentBlock[];
export declare function registerGetBatchTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): void;
export {};
//# sourceMappingURL=get-batch.d.ts.map