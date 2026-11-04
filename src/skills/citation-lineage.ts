import { EXAMPLE_DOI, EXAMPLE_GET_ARGS, type ResearchSop } from './definition.js'

export const citationLineage: ResearchSop = {
  name: 'zotero-citation-lineage',
  component: 'scholarly',
  description:
    'Trace backward and forward citation links around a known seed paper, with bounded graph expansion. Not topic discovery or evidence validation.',
  whenToUse:
    'Use when a known DOI, arXiv ID or PMID anchors a citation-network question. Related papers are similarity edges, never citation edges.',
  triggerKeywords: [
    'backward citation tracing',
    'forward citation tracking',
    'seed paper lookup',
    'citation lineage',
    'citation network',
  ],
  phases: [
    {
      name: 'Resolve seed',
      instruction:
        'Resolve one seed with scholarly_get; confirm identity, identifier and requested direction. No topic keyword search.',
    },
    {
      name: 'Expand first hop',
      instruction:
        'Use scholarly_citations for references and/or citations, limit 10 each. Label direction from the seed explicitly. Use related only when similarity was requested and label it separately.',
    },
    {
      name: 'Expand selected frontier',
      instruction:
        'Maintain visited IDs. Depth cap two hops; expand at most three first-hop nodes total, one requested direction per node, limit 10. Overall cap five graph calls. Never expand every returned node.',
    },
    {
      name: 'Explain and stop',
      instruction:
        'Return observed nodes and directed edges, publication years, selected milestones and unanswered branches. A link proves a citation relationship only; do not infer agreement or intellectual causation without content evidence. Hand a fixed corpus to evidence synthesis if content comparison is needed.',
    },
  ],
  recipes: [
    { tool: 'scholarly_get', args: EXAMPLE_GET_ARGS, purpose: 'Identify the seed' },
    {
      tool: 'scholarly_citations',
      args: { id: EXAMPLE_DOI, direction: 'references', limit: 10 },
      purpose: 'Backward citation edges',
    },
    {
      tool: 'scholarly_citations',
      args: { id: EXAMPLE_DOI, direction: 'citations', limit: 10 },
      purpose: 'Forward citation edges',
    },
    {
      tool: 'scholarly_citations',
      args: { id: EXAMPLE_DOI, direction: 'related', limit: 10 },
      purpose: 'Similarity edges only when requested',
    },
  ],
  failureModes: [
    'Unrecognized seed or absent OpenAlex links: stop that branch, report index coverage; do not repeatedly rename the seed.',
    'Cycle or duplicate: record the edge without revisiting the node.',
    'Stop after two hops, five graph calls or an empty unseen frontier; ranked top results are not a complete citation graph.',
  ],
  output:
    'Seed identity; directed edge list (citing → cited), separate similarity edges; expansion budget and missing branches; a bounded lineage narrative.',
}
