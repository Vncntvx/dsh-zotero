import { EXAMPLE_GET_ARGS } from './definition.js';
export const researchLandscape = {
    name: 'zotero-research-landscape',
    component: 'scholarly',
    description: 'Map a research topic for a proposal or scoping review: bounded discovery, topic clusters and documented gaps. Not seed-paper citation tracing.',
    whenToUse: 'Use for an open research question without a fixed paper corpus. Produce a scoped landscape, not an exhaustive systematic-review claim or a writing draft.',
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
            instruction: 'Record question, population/system, concepts, date range, inclusion/exclusion rules and intended output. Ask only for a missing decision that changes inclusion. Default to relevance and the user’s stated timeframe; do not invent a date filter.',
        },
        {
            name: 'Discover',
            instruction: 'Use scholarly_search with snippets, limit 8, initially automatic source routing. Deduplicate by DOI, then normalized title. Permit at most two query formulations and one targeted filter/source adjustment: three search calls total. Record failed sources and exclusions.',
        },
        {
            name: 'Anchor',
            instruction: 'Choose at most five diverse anchors covering methods, baselines and disagreement; use scholarly_get once per anchor. Do not use citation count as a quality verdict. Reuse existing local metadata via the shared batch recipe.',
        },
        {
            name: 'Synthesize and stop',
            instruction: 'Return theme clusters, anchors, open questions and screening log. Stop at three searches, when required themes have anchors, or after two successive searches add no included work. Candidate gaps remain hypotheses. Hand selected papers to evidence synthesis; use citation lineage only for a seed-specific network question.',
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
        'No hits: allow one alternate formulation within the three-call budget, then report no supported candidates.',
        'Partial index failure: retain answered sources and mark incomplete coverage; do not claim absence.',
        'Systematic review requested: provide this scoping log and state that ranked bounded search cannot certify exhaustive database coverage.',
    ],
    output: 'Question and date scope; search ledger; included/excluded identifiers; theme → anchor table; unresolved gaps and next handoff. No automatic saving.',
};
//# sourceMappingURL=research-landscape.js.map