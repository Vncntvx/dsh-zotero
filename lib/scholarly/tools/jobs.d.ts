/**
 * Background-job envelope shared by the long scholarly tools.
 *
 * The scholarly component owns no delivery wrapper: a completed job carries
 * its rendered text in `JobOutcome.result`, which `job_output` serves to the
 * model. The runner is the same `ZoteroJobRunner` the core heavy tools use,
 * with a scholarly kind, an explicit output ceiling, and no ResultDelivery
 * (scholarly results are text, not durable tool-result receipts).
 *
 * The two arm schemas and the arm renderer are the shared ones in
 * `src/job-runner.ts`; this module must not spell them a second way.
 * @module dsh-zotero/scholarly/tools/jobs
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type InferValue, type ToolExecution } from '@deepseek-ai/dsh-tools';
import { type JobArmResult } from '../../job-runner.js';
import type { ZoteroProgressEvent } from '../../types.js';
import type { ScholarlyToolHost } from './common.js';
import { type ScholarlyToolOutput } from './common.js';
/**
 * Largest scholarly job result the shared runner declares, in UTF-8 bytes.
 *
 * The full-text reader is bounded by the `maxContentChars` schema maximum
 * (50 000 characters); at the worst case of three bytes per character plus the
 * JSON envelope and progress lines, 256 KiB still bounds one model-facing read
 * without clipping a legal result.
 */
export declare const SCHOLARLY_JOB_OUTPUT_LIMIT_BYTES: number;
/** The scholarly output schema: two shared job arms plus the text receipt. */
declare const SCHOLARLY_JOB_OUTPUT_SCHEMA: {
    readonly oneOf: readonly [{
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: 'string';
                readonly required: true;
                readonly const: 'background';
            };
            readonly jobId: {
                readonly type: 'string';
                readonly required: true;
            };
            readonly resultSessionId: {
                readonly type: 'string';
            };
        };
    }, {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly properties: {
            readonly kind: {
                readonly type: 'string';
                readonly required: true;
                readonly const: 'promoted';
            };
            readonly jobId: {
                readonly type: 'string';
                readonly required: true;
            };
            readonly resultSessionId: {
                readonly type: 'string';
            };
            readonly timeoutMs: {
                readonly type: 'number';
                readonly required: true;
            };
            readonly message: {
                readonly type: 'string';
                readonly required: true;
            };
        };
    }, {
        readonly type: 'object';
        readonly additionalProperties: false;
        readonly properties: {
            readonly text: {
                readonly type: 'string';
                readonly required: true;
            };
            readonly papers: {
                readonly type: 'array';
                readonly items: {
                    readonly type: 'object';
                    readonly additionalProperties: true;
                };
            };
            readonly citations: {
                readonly type: 'array';
                readonly items: {
                    readonly type: 'object';
                    readonly additionalProperties: true;
                };
            };
            readonly checks: {
                readonly type: 'array';
                readonly items: {
                    readonly type: 'object';
                    readonly additionalProperties: true;
                };
            };
            readonly document: {
                readonly type: 'object';
                readonly additionalProperties: true;
            };
            readonly issues: {
                readonly type: 'array';
                readonly items: {
                    readonly type: 'string';
                };
            };
            readonly spill: {
                readonly type: 'object';
                readonly additionalProperties: false;
                readonly properties: {
                    readonly locator: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                    readonly bytes: {
                        readonly type: 'integer';
                        readonly required: true;
                    };
                    readonly retrievalHint: {
                        readonly type: 'string';
                        readonly required: true;
                    };
                };
            };
        };
    }];
};
/** One scholarly tool result: a job arm or the text receipt. */
type ScholarlyJobOutput = InferValue<typeof SCHOLARLY_JOB_OUTPUT_SCHEMA>;
/** Render one scholarly result, including the shared promotion reason. */
declare function renderScholarlyJobOutput(_args: unknown, value: ScholarlyJobOutput): ContentBlock[];
/** The scholarly output descriptor with the two job arms. */
export declare const SCHOLARLY_JOB_OUTPUT_DESCRIPTOR: {
    readonly schema: {
        readonly oneOf: readonly [{
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: 'string';
                    readonly required: true;
                    readonly const: 'background';
                };
                readonly jobId: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly resultSessionId: {
                    readonly type: 'string';
                };
            };
        }, {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly kind: {
                    readonly type: 'string';
                    readonly required: true;
                    readonly const: 'promoted';
                };
                readonly jobId: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly resultSessionId: {
                    readonly type: 'string';
                };
                readonly timeoutMs: {
                    readonly type: 'number';
                    readonly required: true;
                };
                readonly message: {
                    readonly type: 'string';
                    readonly required: true;
                };
            };
        }, {
            readonly type: 'object';
            readonly additionalProperties: false;
            readonly properties: {
                readonly text: {
                    readonly type: 'string';
                    readonly required: true;
                };
                readonly papers: {
                    readonly type: 'array';
                    readonly items: {
                        readonly type: 'object';
                        readonly additionalProperties: true;
                    };
                };
                readonly citations: {
                    readonly type: 'array';
                    readonly items: {
                        readonly type: 'object';
                        readonly additionalProperties: true;
                    };
                };
                readonly checks: {
                    readonly type: 'array';
                    readonly items: {
                        readonly type: 'object';
                        readonly additionalProperties: true;
                    };
                };
                readonly document: {
                    readonly type: 'object';
                    readonly additionalProperties: true;
                };
                readonly issues: {
                    readonly type: 'array';
                    readonly items: {
                        readonly type: 'string';
                    };
                };
                readonly spill: {
                    readonly type: 'object';
                    readonly additionalProperties: false;
                    readonly properties: {
                        readonly locator: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                        readonly bytes: {
                            readonly type: 'integer';
                            readonly required: true;
                        };
                        readonly retrievalHint: {
                            readonly type: 'string';
                            readonly required: true;
                        };
                    };
                };
            };
        }];
    };
    readonly render: typeof renderScholarlyJobOutput;
    readonly presentationMeta: (_args: unknown, value: ScholarlyJobOutput) => {};
};
/**
 * Run one long scholarly operation through the shared job policy.
 * @param options - the tool execution, label, body, and explicit-background flag.
 * @returns the body's value, or the background/promoted job arm.
 */
export declare function runScholarlyJob<T extends ScholarlyToolOutput>(options: {
    readonly host: ScholarlyToolHost;
    readonly exec: ToolExecution;
    readonly label: string;
    readonly run: (signal: AbortSignal, onProgress: (event: ZoteroProgressEvent) => void) => Promise<T>;
    readonly runInBackground: boolean;
}): Promise<T | JobArmResult>;
export {};
//# sourceMappingURL=jobs.d.ts.map