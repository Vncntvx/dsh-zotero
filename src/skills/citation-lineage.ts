import { EXAMPLE_DOI, EXAMPLE_GET_ARGS, type ResearchSop } from './definition.js'

export const citationLineage: ResearchSop = {
  name: 'zotero-citation-lineage',
  component: 'scholarly',
  description:
    'Trace references and citing works from an identified seed paper to explain intellectual lineage, follow-up work, or citation paths.',
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
        'Maintain visited IDs and expand a selected frontier only. Default to two hops, three first-hop nodes and five total graph calls. When the user explicitly requests a deeper path or broader coverage, set a finite depth and call budget from the request before expansion. Query one direction per selected node, limit 10. When the host permits, batch the independent incoming and outgoing queries and share the visited set across them.',
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
    'Stop at the recorded depth or call budget, when the requested path is found, or when the unseen frontier is empty. Report which branches the ranked index served.',
  ],
  output:
    'Seed identity; directed edge list (citing → cited), separate similarity edges; expansion budget and missing branches; a bounded lineage narrative.',
}
