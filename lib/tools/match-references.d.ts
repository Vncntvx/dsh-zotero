/** Match BibTeX-like reference metadata against the local Zotero library. */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools';
import { type ToolWrapper } from '../result-delivery.js';
import type { ZoteroService } from '../service.js';
declare const PARAMETERS: {
    readonly references: {
        readonly type: 'array';
        readonly required: true;
        readonly description: "Reference fingerprints; provide a unique inputId and DOI or title. Maximum 50.";
        readonly items: {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly inputId: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly bibKey: {
                    readonly type: 'string';
                };
                readonly doi: {
                    readonly type: 'string';
                };
                readonly title: {
                    readonly type: 'string';
                };
                readonly authors: {
                    readonly type: 'array';
                    readonly items: {
                        readonly type: 'string';
                    };
                };
                readonly year: {
                    readonly type: 'integer';
                };
                readonly venue: {
                    readonly type: 'string';
                };
            };
        };
    };
    readonly includeFieldDiff: {
        readonly type: 'boolean';
        readonly default: false;
        readonly description: 'Include input/Zotero field differences where available.';
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
                readonly type: 'object';
                readonly additionalProperties: true;
                readonly properties: {
                    readonly inputId: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly status: {
                        readonly type: 'string';
                        readonly enum: readonly ['matched', 'ambiguous', 'notFound', 'conflict'];
                        readonly required: true;
                    };
                    readonly bibKey: {
                        readonly type: 'string';
                    };
                    readonly reason: {
                        readonly type: 'string';
                    };
                    readonly selected: {
                        readonly type: 'object';
                        readonly additionalProperties: true;
                    };
                    readonly candidates: {
                        readonly type: 'array';
                        readonly items: {
                            readonly type: 'object';
                            readonly additionalProperties: true;
                        };
                    };
                    readonly fieldDiff: {
                        readonly type: 'object';
                        readonly additionalProperties: true;
                    };
                };
            };
        };
    };
};
export declare function renderMatchReferences(_args: Args, value: Output): ContentBlock[];
export declare function registerMatchReferencesTool(ctx: Context, service: ZoteroService, wrap?: ToolWrapper): void;
export {};
//# sourceMappingURL=match-references.d.ts.map