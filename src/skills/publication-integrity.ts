import { EXAMPLE_GET_ARGS, EXAMPLE_VERIFY_ARGS, type ResearchSop } from './definition.js'

export const publicationIntegrity: ResearchSop = {
  name: 'zotero-publication-integrity',
  component: 'scholarly',
  description:
    'Investigate a suspicious publication identity, DOI mismatch or reported retraction using registry and index records. Not draft semantic support auditing.',
  whenToUse:
    'Use for an explicit integrity concern about known publications. For a supplied manuscript reference list, use the manuscript audit SOP, which batches routine verification itself.',
  triggerKeywords: [
    'retraction screening',
    'suspected fabrication',
    'DOI mismatch',
    'publication integrity',
    'retraction check',
  ],
  phases: [
    {
      name: 'Freeze suspected records',
      instruction:
        'Preserve raw citations, claimed DOI/title/authors/year and the suspected discrepancy. Assign stable input IDs; batch at most 40 reference strings, never discard a tail silently.',
    },
    {
      name: 'Verify registry',
      instruction:
        'Use scholarly_verify once per batch. Preserve the distinction between VERIFIED, CHECK, NOT FOUND and UNVERIFIED; store returned notes and identifiers. A record with no retraction flag is not proof of no retraction.',
    },
    {
      name: 'Resolve discrepancy',
      instruction:
        'For CHECK, NOT FOUND or UNVERIFIED, use scholarly_get once per suspect identifier, at most ten suspect papers per run. Compare source metadata and retraction flags. Title lookup may return the closest candidate: verify its identity before accepting it. No repeated title variants.',
    },
    {
      name: 'Report and stop',
      instruction:
        'Separate identity discrepancy, reported retraction and unavailable sources. Include date checked and which registry/index answered. Escalate unresolved or source-conflicting retraction status to manual publisher/registry review; never claim a comprehensive retraction investigation from these tools.',
    },
  ],
  recipes: [
    {
      tool: 'scholarly_verify',
      args: EXAMPLE_VERIFY_ARGS,
      purpose: 'Batch supplied citation strings, at most 40',
    },
    {
      tool: 'scholarly_get',
      args: EXAMPLE_GET_ARGS,
      purpose: 'One cross-index corroboration per suspect paper',
    },
  ],
  failureModes: [
    'UNVERIFIED means the registry could not answer; it must never become NOT FOUND or fabricated.',
    'NOT FOUND is registry-local absence; one cross-index check then unresolved, not a fraud verdict.',
    'Only source-reported retraction metadata is available. Record absence, uncertainty or conflicting flags honestly; do not auto-delete or tag the library.',
  ],
  output:
    'Per-input identity verdict, field differences, source-reported retraction status, checked-at date, answered/unanswered sources and manual-review queue.',
}
