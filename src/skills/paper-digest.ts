import { EXAMPLE_REF, type ResearchSop } from './definition.js'

export const paperDigest: ResearchSop = {
  name: 'zotero-paper-digest',
  component: 'core',
  description:
    'Produce a structured rapid-reading brief for a single paper with metadata, core evidence passages, and ready-to-copy BibTeX.',
  whenToUse:
    'Use when the user asks to quickly read, summarize, digest, or brief a specific paper in the library. Bounded to one paper at a time.',
  triggerKeywords: [
    'paper digest',
    'literature briefing',
    'quick paper summary',
    'paper takeaway',
    'single paper brief',
  ],
  phases: [
    {
      name: 'Identify and inspect metadata',
      instruction:
        'Locate the item using zotero_get with attachments and annotations. Inspect standard metadata, abstract, and check if an indexed PDF attachment exists. If no attachment exists, proceed in abstract-only degraded mode.',
    },
    {
      name: 'Extract core evidence',
      instruction:
        'Formulate a focused query based on the abstract and user focus, targeting methodology, primary results, and caveats. Call zotero_retrieve with at most 4 passages and attachmentPolicy best. If fulltext is not indexed, report fulltext unavailable instead of inferring details.',
    },
    {
      name: 'Generate citation',
      instruction:
        'Call zotero_export with format bibtex for the item ref to obtain a verified citation block ready for writing tools.',
    },
    {
      name: 'Synthesize structured brief',
      instruction:
        'Output a structured digest card: 1) Paper card with title, creators, year, and attachment status; 2) One-line core contribution; 3) Key findings with exact quotes and observed locators; 4) Limitations or evidence gaps; 5) BibTeX code block. Stop immediately after the brief without launching secondary discovery.',
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
      purpose: 'Inspect item metadata, abstract, attachments, and annotations',
    },
    {
      tool: 'zotero_retrieve',
      args: {
        ref: EXAMPLE_REF,
        query: 'core method baseline dataset limitations',
        sources: ['annotation', 'fulltext'],
        passages: 4,
        attachmentPolicy: 'best',
      },
      purpose: 'Extract located evidence passages for key claims',
    },
    {
      tool: 'zotero_export',
      args: { refs: [EXAMPLE_REF], format: 'bibtex' },
      purpose: 'Generate standard BibTeX citation entry',
    },
  ],
  failureModes: [
    'No attached PDF or extracted fulltext: summarize abstract only and explicitly flag missing body evidence.',
    'Ambiguous item reference: clarify with the user before reading multiple papers.',
    'Missing bibliographic fields: leave them unknown rather than inventing citation details.',
  ],
  output:
    'Structured Markdown brief containing: card header with attachment status, one-line contribution, located evidence passages with quotes and locators, limitations/gaps, and a verified BibTeX code block.',
}
