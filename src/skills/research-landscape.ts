import { EXAMPLE_GET_ARGS, type ResearchSop } from './definition.js'

export const researchLandscape: ResearchSop = {
  name: 'zotero-research-landscape',
  component: 'scholarly',
  description:
    'Discover and synthesize the main approaches and representative papers for an open research topic. Start with a bounded topical search when the corpus has yet to be selected.',
  whenToUse:
    'Use for an open research question without a fixed paper corpus. Produce a scoped landscape, not an exhaustive systematic-review claim or a writing draft.',
  triggerKeywords: [
    'scoping study',
    'research landscape map',
    'topic clustering',
    'scoping review',
    'research landscape',
  ],
  phases: [
    {
      name: 'Frame',
      instruction:
        'Record question, population/system, concepts, date range, inclusion/exclusion rules and intended output. Ask only for a missing decision that changes inclusion. Default to relevance and the user’s stated timeframe; do not invent a date filter.',
    },
    {
      name: 'Discover',
      instruction:
        'Split the question into distinct themes when the requested scope warrants it. Use scholarly_search with snippets, limit 8, initially automatic source routing. In each theme use up to two query formulations and one targeted filter or source adjustment. Start with one theme for a quick map. For a broader requested review, record the themes and the search and anchor budgets before discovery and batch independent searches when the host permits. Deduplicate on a shared DOI/PMID/PMCID/arXiv identity or a matching title and first author within one year. Keep conflicting identifiers and metadata for publication versions distinct. Record failed sources and exclusions.',
    },
    {
      name: 'Anchor',
      instruction:
        'Choose diverse anchors for the methods, baselines and disagreements in each theme. Use up to five per theme within the task budget. Resolve each unique anchor once with scholarly_get, and reuse local metadata through the shared batch recipe. Judge relevance and evidence directly.',
    },
    {
      name: 'Synthesize and stop',
      instruction:
        'Return theme clusters, anchors, open questions and a screening log. Close a theme when it has adequate anchors, two successive searches add no included work, or its search budget is spent. Close discovery when all planned themes are closed. Candidate gaps remain hypotheses. Hand selected papers to evidence synthesis. Use citation lineage for a seed-specific network question.',
    },
  ],
  recipes: [
    {
      tool: 'scholarly_search',
      args: {
        query: 'retrieval augmented generation evaluation',
        limit: 8,
        abstract: 'snippet',
        sort: 'relevance',
      },
      purpose: 'One bounded topic query',
    },
    {
      tool: 'scholarly_get',
      args: EXAMPLE_GET_ARGS,
      purpose: 'Resolve a selected anchor',
    },
  ],
  failureModes: [
    'No hits in a theme: try one alternate formulation within its budget, then report the searched scope and the lack of supported candidates.',
    'Partial index failure: retain answered sources and mark incomplete coverage; do not claim absence.',
    'Systematic review requested: provide this scoping log and state that ranked bounded search cannot certify exhaustive database coverage.',
  ],
  output:
    'Question and date scope; search ledger; included/excluded identifiers; theme → anchor table; unresolved gaps and next handoff. No automatic saving.',
}
