/**
 * Normalization and Match Lattice entity deduplication for scholarly papers.
 * @module dsh-zotero/scholarly/normalize
 */
import type { ScholarlyPaper } from './types.js';
export declare function titleKey(title: string): string;
export declare const SCHOLARLY_STOPWORDS: Set<string>;
export declare function titleTokens(title: string): Set<string>;
/**
 * Derives canonical identifier keys for exact index mapping.
 */
export declare function canonicalKeysOf(paper: ScholarlyPaper): string[];
/**
 * Fills in default URLs and aligns DOI/arXiv identities.
 */
export declare function normalizePaper(paper: ScholarlyPaper): ScholarlyPaper;
/**
 * Merges metadata from `source` into `target` using field inheritance rules.
 */
export declare function mergePaperInto(target: ScholarlyPaper, source: ScholarlyPaper): void;
//# sourceMappingURL=normalize.d.ts.map