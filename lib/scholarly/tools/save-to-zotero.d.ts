import { type InferValue, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ScholarlyToolHost } from './common.js';
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
                readonly enum: readonly ["committed-unverified"];
                readonly required: true;
            };
            readonly committed: {
                readonly type: "boolean";
                readonly enum: readonly [true];
                readonly required: true;
            };
            readonly retryable: {
                readonly type: "boolean";
                readonly enum: readonly [false];
                readonly required: true;
            };
            readonly reason: {
                readonly type: "string";
                readonly enum: readonly ["saved-state-unverified", "commit-unknown"];
                readonly required: true;
            };
            readonly ref: {
                readonly type: "string";
            };
            readonly key: {
                readonly type: "string";
            };
            readonly version: {
                readonly type: "integer";
            };
            readonly libraryVersion: {
                readonly type: "integer";
            };
            readonly serverId: {
                readonly type: "string";
                readonly required: true;
            };
        };
    }, {
        readonly properties: {
            readonly papers: {
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
                        readonly key: {
                            readonly type: "string";
                            readonly required: true;
                        };
                        readonly title: {
                            readonly type: "string";
                        };
                        readonly doi: {
                            readonly type: "string";
                        };
                    };
                };
            };
            readonly kind: {
                readonly type: "string";
                readonly enum: readonly ["applied"];
                readonly required: true;
            };
            readonly ref: {
                readonly type: "string";
                readonly required: true;
            };
            readonly key: {
                readonly type: "string";
                readonly required: true;
            };
            readonly version: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly itemType: {
                readonly type: "string";
                readonly required: true;
            };
            readonly title: {
                readonly type: "string";
            };
            readonly tags: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
            readonly collections: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
            readonly libraryVersion: {
                readonly type: "integer";
                readonly required: true;
            };
            readonly serverId: {
                readonly type: "string";
            };
        };
        readonly type: "object";
        readonly additionalProperties: false;
    }];
};
type SaveOutput = InferValue<typeof OUTPUT>;
export declare function renderScholarlySave(_args: unknown, value: SaveOutput): import("@deepseek-ai/dsh-llm").ContentBlock[];
export declare function createScholarlySaveToZoteroTool(host: ScholarlyToolHost): ToolDefinition;
export {};
//# sourceMappingURL=save-to-zotero.d.ts.map