import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import type { ZoteroService } from '../service.js';
declare const PARAMETERS: {
    readonly refs: {
        readonly type: "array";
        readonly required: true;
        readonly items: {
            readonly type: "string";
        };
        readonly description: "Trashed zotero://user/0/item/<KEY> refs to restore.";
    };
};
type Args = InferArgs<typeof PARAMETERS>;
declare const OUTPUT: {
    readonly oneOf: readonly [{
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["declined"];
                readonly required: true;
            };
        };
    }, {
        readonly type: "object";
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["restored"];
                readonly required: true;
            };
            readonly restored: {
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
                        readonly restored: {
                            readonly type: "boolean";
                            readonly enum: readonly [true];
                            readonly required: true;
                        };
                        readonly version: {
                            readonly type: "integer";
                            readonly required: true;
                        };
                        readonly libraryVersion: {
                            readonly type: "integer";
                            readonly required: true;
                        };
                        readonly serverId: {
                            readonly type: "string";
                        };
                    };
                };
            };
            readonly failed: {
                readonly type: "array";
                readonly required: true;
                readonly items: {
                    readonly type: "object";
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly op: {
                            readonly type: "string";
                            readonly enum: readonly ["create", "update", "delete"];
                            readonly required: true;
                        };
                        readonly ref: {
                            readonly type: "string";
                        };
                        readonly index: {
                            readonly type: "integer";
                        };
                        readonly code: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly message: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly completedRefs: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "string";
                            };
                        };
                    };
                };
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
    }];
};
type Output = InferValue<typeof OUTPUT>;
export declare function renderRestoreItems(_args: Args, value: Output): ContentBlock[];
export declare function registerRestoreItemsTool(ctx: Context, service: ZoteroService): () => void;
export {};
//# sourceMappingURL=restore-items.d.ts.map