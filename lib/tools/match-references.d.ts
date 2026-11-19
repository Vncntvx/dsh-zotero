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
                readonly additionalProperties: false;
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
                            readonly authors: {
                                readonly type: 'array';
                                readonly items: {
                                    readonly type: 'string';
                                };
                            };
                            readonly year: {
                                readonly type: 'integer';
                            };
                            readonly doi: {
                                readonly type: 'string';
                            };
                            readonly venue: {
                                readonly type: 'string';
                            };
                            readonly matchMethod: {
                                readonly type: 'string';
                                readonly enum: readonly ['doi', 'citationKey', 'titleFingerprint'];
                                readonly required: true;
                            };
                            readonly confidence: {
                                readonly type: 'string';
                                readonly enum: readonly ['high', 'medium', 'low'];
                                readonly required: true;
                            };
                        };
                    };
                    readonly candidates: {
                        readonly type: 'array';
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
                                readonly authors: {
                                    readonly type: 'array';
                                    readonly items: {
                                        readonly type: 'string';
                                    };
                                };
                                readonly year: {
                                    readonly type: 'integer';
                                };
                                readonly doi: {
                                    readonly type: 'string';
                                };
                                readonly venue: {
                                    readonly type: 'string';
                                };
                                readonly matchMethod: {
                                    readonly type: 'string';
                                    readonly enum: readonly ['doi', 'citationKey', 'titleFingerprint'];
                                    readonly required: true;
                                };
                                readonly confidence: {
                                    readonly type: 'string';
                                    readonly enum: readonly ['high', 'medium', 'low'];
                                    readonly required: true;
                                };
                            };
                        };
                    };
                    readonly fieldDiff: {
                        readonly type: 'object';
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly title: {
                                readonly type: 'object';
                                readonly additionalProperties: false;
                                readonly properties: {
                                    readonly input: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                    readonly zotero: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                };
                            };
                            readonly doi: {
                                readonly type: 'object';
                                readonly additionalProperties: false;
                                readonly properties: {
                                    readonly input: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                    readonly zotero: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                };
                            };
                            readonly year: {
                                readonly type: 'object';
                                readonly additionalProperties: false;
                                readonly properties: {
                                    readonly input: {
                                        readonly type: 'integer';
                                        readonly required: true;
                                    };
                                    readonly zotero: {
                                        readonly type: 'integer';
                                        readonly required: true;
                                    };
                                };
                            };
                            readonly authors: {
                                readonly type: 'object';
                                readonly additionalProperties: false;
                                readonly properties: {
                                    readonly input: {
                                        readonly type: 'array';
                                        readonly required: true;
                                        readonly items: {
                                            readonly type: 'string';
                                        };
                                    };
                                    readonly zotero: {
                                        readonly type: 'array';
                                        readonly required: true;
                                        readonly items: {
                                            readonly type: 'string';
                                        };
                                    };
                                };
                            };
                            readonly venue: {
                                readonly type: 'object';
                                readonly additionalProperties: false;
                                readonly properties: {
                                    readonly input: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                    readonly zotero: {
                                        readonly type: 'string';
                                        readonly required: true;
                                    };
                                };
                            };
                        };
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