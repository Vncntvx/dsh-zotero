import { EXAMPLE_AUTHOR, EXAMPLE_DOI, EXAMPLE_GET_ARGS, EXAMPLE_REF, EXAMPLE_TITLE, EXAMPLE_VERIFY_ARGS, EXAMPLE_YEAR, } from './definition.js';
export const literatureIntake = {
    name: 'zotero-literature-intake',
    component: 'scholarly',
    description: 'Deduplicate and import user-selected external publications into the personal library through reviewed writes. Not topic discovery or existing-library cleanup.',
    whenToUse: 'Use after the user selects an explicit list of outside publications to save. Discovery alone does not authorize saving. Local core and writeEnabled are prerequisites for execution; otherwise return a proposal only.',
    triggerKeywords: [
        'external work intake',
        'save search results',
        'import selected works',
        'literature intake',
        'save selected papers',
    ],
    phases: [
        {
            name: 'Confirm selection',
            instruction: 'Freeze selected identifiers and destination collection refs; no extra topic search. Use scholarly_get once per selected paper only when verified metadata is missing. A DOI/title lookup is not a raw-PDF importer.',
        },
        {
            name: 'Verify and deduplicate',
            instruction: 'Use scholarly_verify in batches of 40, then zotero_match_references in batches of 50 with unique inputId. Keep DOI/title/authors/year provenance. Skip matched works; ambiguous/conflict or incomplete local scans block import for that work. A NOT FOUND local result means not held, not externally false; external UNVERIFIED remains unresolved.',
        },
        {
            name: 'Prepare import',
            instruction: 'Map observed metadata exactly: single save uses authors/year/abstract; batch create uses creators/date/abstractNote and explicit itemType. Do not send scholarly save fields to the batch API. Use preprint where appropriate, never invent publication metadata, and do not promise PDF download or attachment creation.',
        },
        {
            name: 'Approve and settle',
            instruction: 'Root executes only user-confirmed, sufficiently verified, locally absent items. One selected paper uses scholarly_save_to_zotero; multiple use zotero_batch_items create at min(50, configured limit), with one reviewed plan per batch. Both paths reach the same ctx.zotero write seam. Read back returned refs with zotero_get_batch once. On partial failure/uncertain commit stop all remaining batches and reconcile, not retry.',
        },
    ],
    recipes: [
        {
            tool: 'scholarly_get',
            args: EXAMPLE_GET_ARGS,
            purpose: 'Complete selected metadata when needed',
        },
        {
            tool: 'scholarly_verify',
            args: EXAMPLE_VERIFY_ARGS,
            purpose: 'Verify supplied publication metadata in batches of 40',
        },
        {
            tool: 'zotero_match_references',
            args: {
                references: [{ inputId: 'selected-1', doi: EXAMPLE_DOI, title: EXAMPLE_TITLE }],
            },
            requires: 'Local core available',
            purpose: 'Deduplicate against local holdings, batches of 50',
        },
        {
            tool: 'scholarly_save_to_zotero',
            args: {
                itemType: 'journalArticle',
                title: EXAMPLE_TITLE,
                authors: [EXAMPLE_AUTHOR],
                year: EXAMPLE_YEAR,
                doi: EXAMPLE_DOI,
            },
            requires: 'Root, local core, writeEnabled, verified absent work, user selection and both approvals',
            purpose: 'Single-paper reviewed import',
        },
        {
            tool: 'zotero_batch_items',
            args: {
                create: [
                    {
                        itemType: 'journalArticle',
                        title: EXAMPLE_TITLE,
                        doi: EXAMPLE_DOI,
                        date: '2024',
                        creators: [{ creatorType: 'author', name: EXAMPLE_AUTHOR }],
                    },
                ],
            },
            requires: 'Root, local core, writeEnabled, verified absent works and both approvals',
            purpose: 'Native multi-paper import with exact core field mapping',
        },
        {
            tool: 'zotero_get_batch',
            args: { refs: [EXAMPLE_REF], fields: 'standard' },
            requires: 'Local core available; replace with returned refs',
            purpose: 'One read-back of committed outcomes',
        },
    ],
    failureModes: [
        'No local component or disabled writes: return metadata/proposal, never bypass with a direct Local API request.',
        'Duplicate, ambiguous or conflicting fingerprint: skip or defer that work; do not force insertion.',
        'Approval declined: stop; committed-unverified/unverified entry: treat as potentially committed and reconcile without retry.',
    ],
    output: 'Selected → verified → duplicate/deferred → planned → applied/failed/unverified ledger, returned refs and unresolved commitments. Do not report imported PDFs when only metadata was created.',
};
//# sourceMappingURL=literature-intake.js.map