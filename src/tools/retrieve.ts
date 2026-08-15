/**
 * The `zotero_retrieve` tool: gather evidence passages for one item and
 * rank them against a query. Annotations, notes, the abstract, and
 * full-text chunks compete in one BM25-ranked passage corpus; the result
 * is capped by passage count and character budget with a `truncated` flag
 * instead of mid-passage edits. Full-text passages never carry invented
 * page locators — only annotations keep Zotero's own page label.
 * @module dsh-zotero/tools/retrieve
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type InferValue } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { ZOTERO_INVALID_ARGUMENT, ZoteroError } from '../errors.js'
import { parseRef, requireLocalRef } from '../refs.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroEvidenceSource, ZoteroRetrieveRequest } from '../types.js'

const ALL_SOURCES: ('annotation' | 'note' | 'abstract' | 'fulltext')[] = [
  'annotation',
  'note',
  'abstract',
  'fulltext',
]

const RETRIEVE_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: 'A zotero://user/0/item/<KEY> ref from zotero_search or zotero_get.',
  },
  query: {
    type: 'string',
    required: true,
    description: 'Terms the evidence passages are ranked against.',
  },
  sources: {
    type: 'array',
    items: { type: 'string', enum: ['annotation', 'note', 'abstract', 'fulltext'] },
    default: ALL_SOURCES,
    description:
      'Evidence sources to gather; defaults to all four. Sources the item cannot provide are skipped and reported in sourcesSkipped, not an error.',
  },
  passages: {
    type: 'integer',
    default: 4,
    description:
      'Maximum ranked evidence passages to return; capped by the configured maxEvidencePassages.',
  },
} as const

type RetrieveArgs = InferArgs<typeof RETRIEVE_PARAMETERS>

const EVIDENCE_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    sourceRef: { type: 'string', required: true },
    text: { type: 'string', required: true },
    chunkIndex: { type: 'integer' },
    chunkCount: { type: 'integer' },
    comment: { type: 'string' },
    pageLabel: { type: 'string' },
  },
} as const

const RETRIEVE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    attachmentRef: { type: 'string' },
    coverage: {
      type: 'object',
      additionalProperties: false,
      properties: {
        indexedPages: { type: 'integer' },
        totalPages: { type: 'integer' },
        indexedChars: { type: 'integer' },
        totalChars: { type: 'integer' },
        complete: { type: 'boolean', required: true },
      },
    },
    evidence: { type: 'array', required: true, items: EVIDENCE_RECORD },
    truncated: { type: 'boolean', required: true },
    sourcesSkipped: {
      type: 'array',
      required: true,
      items: { type: 'string', enum: ['annotation', 'note', 'abstract', 'fulltext'] },
    },
  },
} as const

type RetrieveOutput = InferValue<typeof RETRIEVE_OUTPUT_SCHEMA>

function invalid(message: string): never {
  throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT)
}

function buildRequest(args: RetrieveArgs, config: ResolvedConfig): ZoteroRetrieveRequest {
  const query = args.query.trim()
  if (query === '') invalid('query must be a non-empty string of terms to rank evidence against')
  const passages = args.passages ?? 4
  if (!Number.isInteger(passages) || passages < 1 || passages > config.maxEvidencePassages) {
    invalid(
      `passages must be an integer between 1 and ${config.maxEvidencePassages}; got ${passages}`,
    )
  }
  const sources = args.sources ?? ['annotation', 'note', 'abstract', 'fulltext']
  if (sources.length === 0) invalid('sources must list at least one evidence source')
  const ref = parseRef(args.ref)
  requireLocalRef(ref, ['item'])
  return { ref, query, sources: [...sources] as ZoteroEvidenceSource[], passages }
}

export function renderRetrieve(_args: RetrieveArgs, value: RetrieveOutput): ContentBlock[] {
  const lines = [
    `Evidence for ${value.ref} (${value.evidence.length} passage${value.evidence.length === 1 ? '' : 's'})`,
  ]
  if (value.attachmentRef !== undefined) lines.push(`Full text: ${value.attachmentRef}`)
  if (value.coverage !== undefined) {
    const coverage = value.coverage
    const chars =
      coverage.indexedChars === undefined
        ? ''
        : `${coverage.indexedChars}/${coverage.totalChars ?? '?'} chars`
    const pages =
      coverage.indexedPages === undefined
        ? ''
        : `, ${coverage.indexedPages}/${coverage.totalPages ?? '?'} pages`
    lines.push(`Indexing coverage: ${chars}${pages}${coverage.complete ? ' (complete)' : ''}`)
  }
  value.evidence.forEach((entry) => {
    const page =
      entry.pageLabel === undefined ? entry.source : `${entry.source} (page ${entry.pageLabel})`
    const chunk =
      entry.chunkCount === undefined || entry.chunkIndex === undefined
        ? ''
        : `, chunk ${entry.chunkIndex + 1}/${entry.chunkCount}`
    const comment = entry.comment === undefined ? '' : `\nComment: ${entry.comment}`
    lines.push(`\n[${page}${chunk}] ${entry.sourceRef}\n${entry.text}${comment}`)
  })
  if (value.sourcesSkipped.length > 0) {
    lines.push(`\nSkipped unavailable sources: ${value.sourcesSkipped.join(', ')}`)
  }
  if (value.truncated)
    lines.push('\nMore evidence was available but omitted by the passage or character budget.')
  return [{ type: 'text', text: lines.join('\n') }]
}

export function registerRetrieveTool(
  ctx: Context,
  service: ZoteroService,
  config: ResolvedConfig,
): void {
  ctx.tools.register(
    defineTool({
      name: 'zotero_retrieve',
      description: [
        'Gather evidence passages for one Zotero item and rank them against a query.',
        "Sources: annotations (with Zotero's own page labels), notes, the abstract, and BM25-ranked full-text chunks.",
        'A note item contributes its own body; child notes contribute every chunk of their full text (chunkIndex/chunkCount locate each passage).',
        'Unavailable sources are skipped and listed in sourcesSkipped instead of failing the call.',
        'Results are capped by passage count and character budget; a truncated flag signals omitted evidence.',
      ].join(' '),
      parameters: RETRIEVE_PARAMETERS,
      output: {
        schema: RETRIEVE_OUTPUT_SCHEMA,
        render: renderRetrieve,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'search',
        title: 'Retrieve Zotero evidence',
        rawInput: args.query,
      }),
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        return await service.retrieve(buildRequest(args, config), exec.signal)
      },
    }),
  )
}
