import {
  EXAMPLE_DOI,
  EXAMPLE_READ_OUTLINE_ARGS,
  EXAMPLE_REF,
  EXAMPLE_SECOND_REF,
  type ResearchSop,
} from './definition.js'

export const evidenceSynthesis: ResearchSop = {
  name: 'zotero-evidence-synthesis',
  component: 'core',
  description:
    'Compare experiments, methods and findings across a fixed set of papers using located evidence. Not draft claim auditing or literature discovery.',
  whenToUse:
    'Use for a specified corpus of 2–12 papers and a comparison question. For more papers, agree a bounded subset before reading. Missing values remain unknown.',
  triggerKeywords: [
    'cross-paper comparison',
    'experiment comparison',
    'evidence matrix',
    'evidence synthesis',
    'compare methods',
  ],
  phases: [
    {
      name: 'Fix corpus and axes',
      instruction:
        'Fix 2–12 refs/IDs. Specify comparable population, dataset/version, intervention, baseline, metric/unit, split, sample size, uncertainty and limitations. Read known local metadata once in a batch; no broad discovery.',
    },
    {
      name: 'Locate',
      instruction:
        'For external copies, if Scholarly is available inspect outline first, then choose an observed Methods/Results section. For local copies inspect metadata/annotations via a bounded child window; no local outline tool exists. Never read full papers sequentially.',
    },
    {
      name: 'Extract',
      instruction:
        'Use one focused BM25 query per paper, local passages at most 6 (or the smaller configured cap), external passages at most 5. Permit one reformulation only if the first returns inadequate evidence. For external structured text combine section and query. Cap at two BM25 calls per paper; one bounded section/chunk of at most 4000 chars is the final fallback, then mark missing.',
    },
    {
      name: 'Compare and stop',
      instruction:
        'Every filled comparison cell needs a source ID, quote and observed locator. Distinguish extracted data from your inference. Do not combine incompatible metrics, datasets or units into a ranking. Finish after every paper/axis is supported, not reported or unavailable. Do not turn missing evidence into a claim of no effect.',
    },
  ],
  recipes: [
    {
      tool: 'zotero_get',
      args: {
        ref: EXAMPLE_REF,
        include: ['annotations', 'attachments'],
        childPages: {
          annotations: { offset: 0, limit: 20 },
          attachments: { offset: 0, limit: 10 },
        },
      },
      purpose: 'Locate attachment and existing page-labelled annotations',
    },
    {
      tool: 'zotero_retrieve',
      args: {
        ref: EXAMPLE_REF,
        query: 'dataset sample size baseline accuracy limitations',
        sources: ['annotation', 'fulltext'],
        passages: 4,
        attachmentPolicy: 'best',
      },
      purpose: 'Local evidence with explicit coverage',
    },
    {
      tool: 'scholarly_read',
      args: EXAMPLE_READ_OUTLINE_ARGS,
      requires: 'Scholarly component and tool available; external source selected',
      purpose: 'Locate section headings before evidence extraction',
    },
    {
      tool: 'scholarly_read',
      args: {
        id: EXAMPLE_DOI,
        section: 'Methods',
        query: 'sample size baseline evaluation dataset',
        passages: 5,
      },
      requires: 'Scholarly available; substitute an observed section name',
      purpose: 'BM25 within the observed section',
    },
    {
      tool: 'scholarly_read',
      args: { id: EXAMPLE_DOI, section: 'Methods', start: 0, max_chars: 4000 },
      requires: 'Scholarly available; observed section and insufficient BM25 evidence',
      purpose: 'One bounded final fallback, not a fulltext crawl',
    },
    {
      tool: 'zotero_get_batch',
      args: { refs: [EXAMPLE_REF, EXAMPLE_SECOND_REF], fields: 'standard' },
      purpose: 'Read the fixed local corpus once',
    },
  ],
  failureModes: [
    'Unindexed attachment or incomplete coverage: report sourcesSkipped/coverage/truncated and leave affected cells unresolved.',
    'No pageLabel: use observed chunk/character/section locator and page unavailable, never infer PDF page numbers.',
    'Only abstract or comment evidence: label its evidence level; do not present it as full-method verification.',
  ],
  output:
    'A comparison matrix with per-cell provenance, exact units and uncertainty; a separate interpretation; coverage and missing-data ledger. No unsolicited note write.',
}
