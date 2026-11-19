/**
 * Common contracts, descriptors, and helpers shared across scholarly tools.
 * @module dsh-zotero/scholarly/tools/common
 */
import type { Context } from '@deepseek-ai/cordis';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { SpillRef } from '@deepseek-ai/dsh-spill';
import type { ScholarlyHttp } from '../transport/http.js';
import type { ScholarlyKeys } from '../types.js';
import type { JobPolicy, ZoteroJobRunner } from '../../job-runner.js';
import type { ZoteroServiceLike } from '../zotero-link.js';
import type { FulltextEnhancer } from '../../local/fulltext-enhancer.js';
import type { EvidenceRanker } from '../../local/evidence-ranker.js';
export interface ScholarlyToolHost {
    http: ScholarlyHttp;
    keys(): Promise<ScholarlyKeys>;
    maxResults(): number;
    jobPolicy(): JobPolicy;
    jobRunner(): ZoteroJobRunner;
    zoteroService?(): ZoteroServiceLike | undefined;
    /** Optional higher-quality document parser from the enrichment component. */
    enrichmentEnhancer?(): FulltextEnhancer | undefined;
    /**
     * The ranking strategy passage matching uses: the core's lexical ranker, or
     * the hybrid one the enrichment component installs. Required: without it,
     * `scholarly_read` and `zotero_retrieve` can rank the same paper by different
     * rules.
     */
    evidenceRanker(): EvidenceRanker;
    /**
     * The chunk boundaries passage matching cuts on. Required: without them the
     * two tools would silently describe one paper with different passages.
     */
    evidenceChunkLimits(): {
        readonly chunkWords: number;
        readonly chunkChars: number;
    };
    ctx?: Context;
}
/** One bounded, model-readable Scholarly receipt. Text remains the human rendering. */
export declare const SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR: {
    readonly schema: {
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
    };
    readonly render: (_args: unknown, value: {
        text: string;
        spill?: {
            readonly locator: string;
            readonly bytes: number;
            readonly retrievalHint: string;
        };
    }) => {
        type: 'text';
        text: string;
    }[];
};
export type ScholarlyToolOutput = {
    text: string;
    papers?: Array<Record<string, JsonValue>>;
    citations?: Array<Record<string, JsonValue>>;
    checks?: Array<Record<string, JsonValue>>;
    document?: Record<string, JsonValue>;
    issues?: string[];
    spill?: SpillRef;
};
export declare function toCleanJsonRecord<T extends object>(item: T): Record<string, JsonValue>;
export declare function toCleanJsonRecords<T extends object>(items: readonly T[]): Array<Record<string, JsonValue>>;
//# sourceMappingURL=common.d.ts.map