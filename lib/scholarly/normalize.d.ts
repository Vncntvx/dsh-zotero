/**
 * Normalization and identity-based deduplication for scholarly papers.
 *
 * A fused entry absorbs records that describe the same work. Strong
 * identifiers (published DOI, PMID, PMCID, arXiv ID) establish identity;
 * title evidence supplies the candidate gate. Records with distinct metadata,
 * such as a preprint and its published version, retain their record-level
 * metadata in `versions`.
 * @module dsh-zotero/scholarly/normalize
 */
import type { PaperVersion, ScholarlyPaper } from './types.js';
export declare function titleKey(title: string): string;
export declare const SCHOLARLY_STOPWORDS: Set<string>;
export declare function titleTokens(title: string): Set<string>;
/**
 * Order-insensitive title signature: the same token set regardless of word
 * order, punctuation, or stopwords. Titles with fewer than three tokens have
 * no signature.
 */
export declare function titleSignature(title: string): string | undefined;
/** The fields every strong-identity check reads. */
type IdentityFields = Pick<ScholarlyPaper, 'doi' | 'arxiv' | 'pmid' | 'pmcid'>;
interface PaperIdentity {
    publishedDois: ReadonlySet<string>;
    arxivIds: ReadonlySet<string>;
    pmids: ReadonlySet<string>;
    pmcids: ReadonlySet<string>;
}
/** The published DOI of a record, if it has one. */
export declare function publishedDoiOf(paper: IdentityFields): string | undefined;
/**
 * Every strong identifier a record carries. The arXiv DOI is translated into
 * an arXiv ID instead of a published DOI, allowing a preprint and its
 * published version to share the arXiv identity.
 */
export declare function identityOf(paper: IdentityFields): PaperIdentity;
/**
 * Identity keys for the fusion index. Titles provide candidate evidence; the
 * index uses strong identifiers to name records.
 */
export declare function identityKeysOf(paper: IdentityFields): string[];
export type IdentityRelation = 'same' | 'version' | 'distinct';
interface IdentityVerdict {
    relation: IdentityRelation;
    /** Some strong identifier kind exists on both sides with different values. */
    conflicting: boolean;
}
/**
 * Decide what two records are to each other.
 *
 * - `same`: one record seen twice. A shared published DOI decides this on its
 *   own; otherwise every shared strong identifier must agree. A conflicting
 *   secondary identifier next to a shared DOI is a registry data defect, not
 *   evidence of a second work.
 * - `version`: a verifiable version relationship, such as a shared PMID or
 *   arXiv ID with different published DOIs.
 * - `distinct`: no shared identity, with at least one conflicting identifier
 *   kind. These records remain separate.
 */
export declare function identityRelationOf(a: IdentityFields, b: IdentityFields): IdentityVerdict;
/**
 * Whether two records name the same first author. Surname equality alone would
 * treat "Alice Example" and "Bob Example" as one person; the given-name initial
 * keeps them apart while still accepting "A. Vaswani" for "Ashish Vaswani".
 */
export declare function firstAuthorCompatible(left: readonly string[], right: readonly string[]): boolean;
/**
 * The narrow title-based merge gate. Compatible candidates must share the
 * same title token set (at least three tokens), first author, and publication
 * years within one. These checks distinguish similar titles, authors, and
 * publication years.
 */
export declare function titleVersionMatch(a: ScholarlyPaper, b: ScholarlyPaper): boolean;
/**
 * Fills in default URLs and aligns DOI/arXiv identities.
 */
export declare function normalizePaper(paper: ScholarlyPaper): ScholarlyPaper;
/** Project one record into its version entry. */
export declare function versionOf(paper: ScholarlyPaper): PaperVersion;
/**
 * Record a version on a fused paper, merging new sources and missing fields
 * into an existing version with the same identity.
 */
export declare function addVersionRecord(target: ScholarlyPaper, source: PaperVersion): void;
export type MergeRelation = 'same' | 'version';
/**
 * Merge metadata from `source` into `target`.
 *
 * `same` is the one-record-twice case: every field may improve, and a
 * retraction travels with the record. `version` is a preprint/published pair or
 * another verified version relationship: the primary record keeps its own
 * title, abstract, authors, and retraction state, and the incoming record is
 * preserved separately in `versions`.
 */
export declare function mergePaperInto(target: ScholarlyPaper, source: ScholarlyPaper, relation: MergeRelation): void;
export {};
//# sourceMappingURL=normalize.d.ts.map