/**
 * Structural and identity validation for citation bodies returned by DOI
 * content negotiation.
 *
 * A citation is accepted when the body parses as the requested format and
 * names the requested DOI. Other responses become failed items with reasons.
 * @module dsh-zotero/scholarly/citation-format
 */
/** The citation formats this tool asks a registration agency for. */
export type CiteFormat = 'bibtex' | 'ris' | 'csljson' | 'text';
export type CitationValidation = {
    ok: true;
    value: string;
    resolvedDoi: string;
} | {
    ok: false;
    reason: string;
};
/** Compare DOIs case-insensitively after the same cleanup the registry output uses. */
export declare function normalizeDoiForCompare(value: string): string | undefined;
/** CSL-JSON: one object (or a one-element array) with a title and the requested DOI. */
export declare function validateCslJson(body: string, requestedDoi: string): CitationValidation;
/** BibTeX: an `@type{...}` entry carrying the requested DOI field. */
export declare function validateBibtex(body: string, requestedDoi: string): CitationValidation;
/** RIS: `TY  - <type>` ... `DO  - <doi>` ... `ER  -`. */
export declare function validateRis(body: string, requestedDoi: string): CitationValidation;
/** Formatted text: non-empty prose, never an HTML or plain error page. */
export declare function validateFormattedText(body: string, requestedDoi: string): CitationValidation;
/** Validate one response against the format that was requested. */
export declare function validateCitation(format: CiteFormat, body: string, requestedDoi: string): CitationValidation;
//# sourceMappingURL=citation-format.d.ts.map