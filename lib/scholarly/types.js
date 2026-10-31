/**
 * Types and canonical interfaces for the scholarly literature subsystem.
 * @module dsh-zotero/scholarly/types
 */
/**
 * The component's seven model tools, in registration order (the factory's
 * order in `src/scholarly/tools/index.ts`).
 *
 * One list for the component's own policy text and for the test helper. The
 * tools still declare their own `name:` in their definition files, exactly as
 * the local component's tools do beside `src/constants.ts`; the composition
 * test ties the two lists together by comparing this constant with the tools
 * the registry actually holds.
 */
export const SCHOLARLY_TOOL_NAMES = [
    'scholarly_search',
    'scholarly_get',
    'scholarly_citations',
    'scholarly_read',
    'scholarly_cite',
    'scholarly_verify',
    'scholarly_save_to_zotero',
];
export const SCHOLARLY_SOURCE_IDS = [
    'arxiv',
    'openalex',
    'crossref',
    'semanticscholar',
    'pubmed',
    'europepmc',
    'dblp',
];
export const SCHOLARLY_SOURCE_NAMES = {
    arxiv: 'arXiv',
    openalex: 'OpenAlex',
    crossref: 'Crossref',
    semanticscholar: 'Semantic Scholar',
    pubmed: 'PubMed',
    europepmc: 'Europe PMC',
    dblp: 'DBLP',
};
//# sourceMappingURL=types.js.map