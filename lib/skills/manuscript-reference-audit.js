import { EXAMPLE_DOI, EXAMPLE_READ_OUTLINE_ARGS, EXAMPLE_REF, EXAMPLE_TITLE, EXAMPLE_VERIFY_ARGS, } from './definition.js';
export const manuscriptReferenceAudit = {
    name: 'zotero-manuscript-reference-audit',
    component: 'core',
    description: 'Audit user-supplied draft claims, BibTeX keys and reference lists against local records and passages. Not manuscript editing, topic discovery or cross-paper synthesis.',
    whenToUse: 'Use for a provided draft/reference list. Audit claim → citation → record → supporting passage; request absent draft text or bibliographic fields rather than inventing them. Do not edit local manuscript files.',
    triggerKeywords: [
        'draft reconciliation',
        'citation support check',
        'reference audit',
        'manuscript audit',
        'BibTeX audit',
    ],
    phases: [
        {
            name: 'Inventory',
            instruction: 'Assign stable claim IDs and reference inputId values from supplied text. Separate missing bibliography entries, unused entries, citation-key identity and semantic support. Freeze this input set; do not discover new topic papers.',
        },
        {
            name: 'Reconcile identity',
            instruction: 'Use zotero_match_references with includeFieldDiff:true, at most 50 per batch. DOI or title is required; a bare BibTeX key is insufficient. Use zotero_get_batch for unique matched refs, standard fields. Permit one rerun only for changed input fingerprints supplied or resolved from evidence. Keep ambiguous/conflict unresolved.',
        },
        {
            name: 'Audit support',
            instruction: 'Locate evidence as in the execution contract; use zotero_retrieve at most 4 passages for each unique claim/ref question, with one reformulation maximum. If Scholarly is available, use scholarly_read outline then query for an external copy. Evaluate claim strength, population, metric and caveats; classify supported, partially supported, contradicted or not assessable. A matching title or registry record is not semantic support.',
        },
        {
            name: 'Report discrepancies',
            instruction: 'Optional registry verification is batched at 40 references; official citation formatting at 30 IDs. Local export batches at 50 same-library refs; distinguish citationKey from translator exportKey. Finish when every input has an outcome, including unresolved. Suggest precise claim/citation corrections as text, without modifying manuscript or library.',
        },
    ],
    recipes: [
        {
            tool: 'zotero_match_references',
            args: {
                references: [
                    {
                        inputId: 'ref-1',
                        bibKey: 'example2024',
                        doi: EXAMPLE_DOI,
                        title: EXAMPLE_TITLE,
                    },
                ],
                includeFieldDiff: true,
            },
            purpose: 'Batch identity and field-diff audit',
        },
        {
            tool: 'zotero_retrieve',
            args: {
                ref: EXAMPLE_REF,
                query: 'the specific draft claim and its limitation',
                sources: ['annotation', 'fulltext'],
                passages: 4,
            },
            purpose: 'Test one claim against located passages',
        },
        {
            tool: 'scholarly_read',
            args: EXAMPLE_READ_OUTLINE_ARGS,
            requires: 'Scholarly available and external copy needed',
            purpose: 'Locate external sections',
        },
        {
            tool: 'scholarly_read',
            args: {
                id: EXAMPLE_DOI,
                query: 'the specific draft claim and its limitation',
                passages: 4,
            },
            requires: 'Scholarly available; outline inspected first',
            purpose: 'Extract external support',
        },
        {
            tool: 'scholarly_verify',
            args: EXAMPLE_VERIFY_ARGS,
            requires: 'Scholarly available; registry identity check needed',
            purpose: 'Batch reference accuracy check, maximum 40',
        },
        {
            tool: 'scholarly_cite',
            args: { ids: [EXAMPLE_DOI], format: 'csljson' },
            requires: 'Scholarly available; official formatting requested',
            purpose: 'Official citation data, maximum 30',
        },
        {
            tool: 'zotero_export',
            args: { refs: [EXAMPLE_REF], format: 'bibtex' },
            purpose: 'Check translator exportKey separately from local citationKey',
        },
    ],
    failureModes: [
        'Only citation keys supplied: ask for bibliography metadata once, then mark missing fingerprints; never guess refs.',
        'Conflicting citekey or multiple matches: do not select, overwrite or rename keys automatically.',
        'UNVERIFIED registry result or missing fulltext: preserve unknown status; no fabricated-paper accusation or unsupported verdict.',
    ],
    output: 'Claim ID → supplied citation → selected ref/ID → evidence/locator → support verdict → suggested correction; separate bibliography differences, key conflicts and coverage. Preserve user text.',
};
//# sourceMappingURL=manuscript-reference-audit.js.map