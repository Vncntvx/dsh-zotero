/**
 * Lawful Open Access full-text resolver.
 *
 * Tries, in order: arXiv HTML, ar5iv HTML, the arXiv PDF, PMC JATS XML via
 * Europe PMC, then an open-access PDF located through OpenAlex, Unpaywall, or
 * Semantic Scholar. Every attempt records why it failed, so the terminal error
 * can name the causes instead of asserting "likely a paywall": a 429, an
 * oversized PDF, and an absent copy are three different facts.
 * @module dsh-zotero/scholarly/fulltext/resolve
 */
import type { ScholarlyHttp } from '../transport/http.js';
import type { ScholarlyKeys } from '../types.js';
import type { FullTextRecord, ScholarlyTextStore } from './store.js';
type PaperIdentifier = {
    kind: 'arxiv';
    id: string;
} | {
    kind: 'doi';
    id: string;
} | {
    kind: 'pmid';
    id: string;
} | {
    kind: 'pmcid';
    id: string;
} | {
    kind: 'url';
    id: string;
};
export declare function parsePaperIdentifier(raw: string): PaperIdentifier | undefined;
export declare function openAlexIdOf(id: PaperIdentifier): string | undefined;
interface ScholarlyResolutionContext {
    readonly http: ScholarlyHttp;
    readonly keys?: ScholarlyKeys;
    readonly store?: ScholarlyTextStore;
    readonly signal?: AbortSignal;
}
export declare function resolveScholarlyFullText(target: PaperIdentifier, context: ScholarlyResolutionContext): Promise<FullTextRecord>;
export {};
//# sourceMappingURL=resolve.d.ts.map