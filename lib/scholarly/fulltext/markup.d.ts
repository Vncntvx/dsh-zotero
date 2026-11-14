/**
 * Markup converters for arXiv HTML (LaTeXML/ar5iv), JATS XML, and PDF.
 * Converts structured academic formats into plain Markdown with preserved headings and formulas.
 * @module dsh-zotero/scholarly/fulltext/markup
 */
/**
 * Extracts and converts the <article> section of an arXiv HTML page to Markdown.
 */
export declare function arxivHtmlToMarkdown(html: string): string | undefined;
/**
 * Converts a PubMed Central article (JATS XML) to Markdown.
 */
export declare function jatsToMarkdown(xml: string): string | undefined;
/**
 * Extract plain text from a PDF buffer, one `[page n]` block per page, through
 * unpdf (pdf.js).
 *
 * Teardown is `loadingTask.destroy()`: that is the pdf.js call that releases
 * the worker and transport, and it is what unpdf itself calls.
 * `PDFDocumentProxy` has no `destroy` of its own. `cleanup()` exists but only
 * releases page resources, which `destroy()` supersedes.
 */
export declare function extractPdfText(data: Uint8Array): Promise<string>;
//# sourceMappingURL=markup.d.ts.map