/**
 * The `zotero_retrieve` tool: gather evidence passages for one item and
 * rank them against a query. Annotations, notes, the abstract, and
 * full-text chunks compete in one ranked passage corpus; each passage reports
 * why it was returned (`matchKind`) so a meaning-level hit is never presented
 * as wording the source contains. The result is capped by passage count and
 * character budget with a `truncated` flag instead of mid-passage edits.
 * Full-text passages never carry invented page locators; only annotations keep
 * Zotero's own page label.
 * @module dsh-zotero/tools/retrieve
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { ZOTERO_MAX_QUERY_VARIANTS } from '../constants.js'
import { invalidArgs } from '../errors.js'
import { formatRef, parseSupportedRef, sameLibrary } from '../refs.js'
import { queryVariantsOf } from './query-variants.js'
import { boundedPresentationMeta, projectRetrieveMeta } from '../presentation-meta.js'
import { identityToolWrapper, type ToolWrapper } from '../result-delivery.js'
import { metaRecordOf } from './present.js'
import { assertIntInRange, assertNonEmptyList, REF_ARG_HINT } from './validate.js'
import type { ZoteroService } from '../service.js'
import type {
  ZoteroEvidenceField,
  ZoteroEvidenceSource,
  ZoteroObjectRef,
  ZoteroRetrieveRequest,
} from '../types.js'
import type { EvidenceMatchKind } from '../evidence-item.js'

const ALL_SOURCES: ZoteroEvidenceSource[] = ['annotation', 'note', 'abstract', 'fulltext']

const DEFAULT_PASSAGES = 4

const RETRIEVE_PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${REF_ARG_HINT} ref from zotero_search or zotero_get.`,
  },
  query: {
    type: 'string',
    required: true,
    description: 'Terms the evidence passages are ranked against.',
  },
  queryVariants: {
    type: 'array',
    items: { type: 'string' },
    description: `Extra phrasings of the same question (synonyms, field terminology), at most ${ZOTERO_MAX_QUERY_VARIANTS}; each is a separate scoring pass, and the best score per passage wins.`,
  },
  sources: {
    type: 'array',
    items: { type: 'string', enum: ['annotation', 'note', 'abstract', 'fulltext'] },
    default: ALL_SOURCES,
    description: 'Sources to gather (default all); unavailable sources appear in sourcesSkipped.',
  },
  passages: {
    type: 'integer',
    default: DEFAULT_PASSAGES,
    description: 'Passage cap, bounded by maxEvidencePassages.',
  },
  attachmentPolicy: {
    type: 'string',
    enum: ['best', 'allIndexed', 'specified'],
    description: 'Full-text source: best (default), allIndexed PDFs, or specified attachmentRefs.',
  },
  attachmentRefs: {
    type: 'array',
    items: { type: 'string' },
    description:
      'For specified: attachment refs belonging to ref in the same library and instance; repeats read once, bounded by retrieveAttachmentCap.',
  },
} as const

type RetrieveArgs = InferArgs<typeof RETRIEVE_PARAMETERS>

const FULLTEXT_FORMAT = { type: 'string', enum: ['markdown', 'text'] } as const

const ARTIFACT_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    parser: { type: 'string', enum: ['mineru'], required: true },
    mode: { type: 'string', enum: ['free', 'pro'], required: true },
    artifactId: { type: 'string', required: true },
    fingerprint: { type: 'string', required: true },
    sourceId: { type: 'string', required: true },
    generation: { type: 'string', required: true },
  },
} as const

const EVIDENCE_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: {
      type: 'string',
      enum: ALL_SOURCES,
      required: true,
    },
    sourceRef: { type: 'string', required: true },
    text: { type: 'string', required: true },
    textFormat: FULLTEXT_FORMAT,
    artifact: ARTIFACT_RECORD,
    start: { type: 'integer' },
    end: { type: 'integer' },
    chunkIndex: { type: 'integer' },
    chunkCount: { type: 'integer' },
    comment: { type: 'string' },
    pageLabel: { type: 'string' },
    attachmentRef: { type: 'string' },
    matchKind: {
      type: 'string',
      enum: ['lexical', 'semantic', 'hybrid'],
      required: true,
    },
    matchedFields: { type: 'array', items: { type: 'string', enum: ['text', 'comment'] } },
  },
} as const

const COVERAGE_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    indexedPages: { type: 'integer' },
    totalPages: { type: 'integer' },
    indexedChars: { type: 'integer' },
    totalChars: { type: 'integer' },
    complete: { type: 'boolean', required: true },
  },
} as const

const RETRIEVE_ATTACHMENT_RECORD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    contentType: { type: 'string' },
    status: { type: 'string', enum: ['indexed', 'unindexed', 'unread'], required: true },
    textFormat: FULLTEXT_FORMAT,
    artifact: ARTIFACT_RECORD,
    coverage: COVERAGE_RECORD,
    inputTruncated: { type: 'boolean' },
    passages: { type: 'integer' },
  },
} as const

const RETRIEVE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'string', required: true },
    attachmentRef: { type: 'string' },
    attachmentContentType: { type: 'string' },
    textFormat: FULLTEXT_FORMAT,
    artifact: ARTIFACT_RECORD,
    coverage: COVERAGE_RECORD,
    attachments: { type: 'array', items: RETRIEVE_ATTACHMENT_RECORD },
    evidence: { type: 'array', required: true, items: EVIDENCE_RECORD },
    truncated: { type: 'boolean', required: true },
    sourcesSkipped: {
      type: 'array',
      required: true,
      items: { type: 'string', enum: ['annotation', 'note', 'abstract', 'fulltext'] },
    },
    queryTerms: { type: 'array', required: true, items: { type: 'string' } },
    noMatch: { type: 'string', enum: ['no-overlap', 'no-sources'] },
    rankedRoutes: { type: 'array', items: { type: 'string', enum: ['lexical', 'semantic'] } },
  },
} as const

type RetrieveOutput = InferValue<typeof RETRIEVE_OUTPUT_SCHEMA>

/** The model-facing messages the retrieve argument rules throw. */
export const RETRIEVE_QUERY_EMPTY_MESSAGE =
  'query must be a non-empty string of terms to rank evidence against'
export const RETRIEVE_SOURCES_EMPTY_MESSAGE = 'sources must list at least one evidence source'
export const RETRIEVE_SPECIFIED_EMPTY_MESSAGE =
  'attachmentPolicy "specified" requires at least one attachmentRef'
export const RETRIEVE_SPECIFIED_ONLY_MESSAGE =
  'attachmentRefs is only valid with attachmentPolicy="specified"'

/**
 * The message for an attachmentRef outside the item's own library: the ref's
 * library is named so the model can see which identity the list must match.
 */
export function attachmentRefsLibraryMessage(library: string): string {
  return `attachmentRefs must belong to the same library as ref (${library})`
}

/**
 * The message for a list of distinct attachmentRefs past the per-call cap.
 * The count names how much work the call asked for and the cap names the
 * split point.
 */
export function attachmentRefsOverCapMessage(count: number, cap: number): string {
  return `attachmentRefs lists ${count} attachments; at most ${cap} can enter one ranking; split the work across calls`
}

function buildRequest(args: RetrieveArgs, config: ResolvedConfig): ZoteroRetrieveRequest {
  const query = args.query.trim()
  if (query === '') invalidArgs(RETRIEVE_QUERY_EMPTY_MESSAGE)
  const queryVariants = queryVariantsOf(args.queryVariants)
  const passages = args.passages ?? DEFAULT_PASSAGES
  assertIntInRange('passages', passages, 1, config.maxEvidencePassages)
  const sources = args.sources ?? ALL_SOURCES
  assertNonEmptyList(sources, RETRIEVE_SOURCES_EMPTY_MESSAGE)
  const ref = parseSupportedRef(args.ref, ['item'])
  const policy = args.attachmentPolicy ?? 'best'
  let attachmentRefs: ZoteroObjectRef[] | undefined
  if (args.attachmentPolicy === 'specified') {
    const raw = args.attachmentRefs ?? []
    if (raw.length === 0) {
      invalidArgs(RETRIEVE_SPECIFIED_EMPTY_MESSAGE)
    }
    attachmentRefs = []
    // The list is a set: the same attachment named twice would be read twice
    // and would enter the ranking twice, which reads as two sources agreeing
    // with each other. Order stays the caller's; instance-qualified refs stay
    // distinct, because a foreign instance is refused rather than folded in.
    const seen = new Set<string>()
    for (const value of raw) {
      const attachmentRef = parseSupportedRef(value, ['attachment'])
      const identity = formatRef(attachmentRef)
      if (seen.has(identity)) continue
      seen.add(identity)
      if (!sameLibrary(attachmentRef.library, ref.library)) {
        invalidArgs(attachmentRefsLibraryMessage(`${ref.library.type}/${ref.library.id}`))
      }
      attachmentRefs.push(attachmentRef)
    }
    if (attachmentRefs.length > config.retrieveAttachmentCap) {
      invalidArgs(attachmentRefsOverCapMessage(attachmentRefs.length, config.retrieveAttachmentCap))
    }
  } else if (args.attachmentRefs !== undefined) {
    invalidArgs(RETRIEVE_SPECIFIED_ONLY_MESSAGE)
  }
  return {
    ref,
    query,
    ...(queryVariants === undefined ? {} : { queryVariants }),
    sources: [...sources],
    passages,
    ...(args.attachmentPolicy !== undefined ? { attachmentPolicy: policy } : {}),
    ...(attachmentRefs !== undefined ? { attachmentRefs } : {}),
  }
}

/**
 * How the render names each field a passage can match in. The comment label
 * spells out whose words they are: a hit found only there is the annotator's
 * view of the paper, which the model must not attribute to the paper.
 */
const MATCH_FIELD_LABELS = {
  text: 'quoted text',
  comment: 'the reader\u2019s comment',
} as const satisfies Record<ZoteroEvidenceField, string>

/**
 * The clause appended to a match line whose only hit is a reader comment:
 * those words are the annotator's, not the paper's.
 */
export const PASSAGE_COMMENT_ONLY_CLAUSE =
  'those are the annotator\u2019s words, not the paper\u2019s own text'

/** The one-line account of which fields carried the query terms. */
function matchLine(fields: readonly ZoteroEvidenceField[]): string {
  const where = fields.map((field) => MATCH_FIELD_LABELS[field]).join(' and ')
  const onlyComment =
    fields.includes('comment') && !fields.includes('text')
      ? ` — ${PASSAGE_COMMENT_ONLY_CLAUSE}`
      : ''
  return `Matched in: ${where}${onlyComment}`
}

/** The short label each match kind renders as inside a passage's bracket. */
const MATCH_KIND_LABELS = {
  lexical: 'query words',
  semantic: 'meaning only',
  hybrid: 'query words and meaning',
} as const satisfies Record<EvidenceMatchKind, string>

/**
 * The bracket suffix naming why a passage was returned, empty for the ordinary
 * case (the passage's own words carry the query), which readers assume.
 * Other kinds change how the passage may be used, so they are labeled.
 *
 * An absent kind renders as nothing: sessions recorded before this field
 * replay with `matchKind` missing, and indexing the label table with
 * `undefined` would print "undefined" into the evidence.
 * @param kind - the recorded match kind, possibly absent on a replayed record.
 * @returns the suffix, empty when there is nothing to say.
 */
function matchSuffix(kind: EvidenceMatchKind | undefined): string {
  if (kind === undefined || kind === 'lexical') return ''
  return `, ${MATCH_KIND_LABELS[kind]}`
}

/** The one-line note explaining what a semantic-only hit did and did not do. */
export const SEMANTIC_ONLY_NOTE =
  'matched on meaning, not on wording: do not quote this passage as containing the query\u2019s terms'

/** The model-facing note for an attachment Zotero has not indexed. */
export const ATTACHMENT_UNINDEXED_NOTE = "no full text in Zotero's index"

/** The model-facing note for an attachment this call's cap left unread. */
export const ATTACHMENT_LIMIT_NOTE = 'not read: this call was already at its attachment limit'

/**
 * The honesty line under the full-text sources: how many of them contributed
 * no text, so whatever they contain is not covered.
 */
export function silentAttachmentsMessage(silent: number, total: number): string {
  return `${silent} of these ${total} attachments contributed no text, so whatever they contain is not covered here.`
}

/** One full-text source's own facts: what it is, what it gave, what it could not. */
function attachmentSourceLine(source: NonNullable<RetrieveOutput['attachments']>[number]): string {
  const type = source.contentType === undefined ? '' : ` (${source.contentType})`
  if (source.status === 'unindexed') {
    return `${source.ref}${type}: ${ATTACHMENT_UNINDEXED_NOTE}`
  }
  if (source.status === 'unread') {
    return `${source.ref}${type}: ${ATTACHMENT_LIMIT_NOTE}`
  }
  const chars =
    source.coverage?.indexedChars === undefined
      ? ''
      : `, ${source.coverage.indexedChars}/${source.coverage.totalChars ?? '?'} chars indexed`
  const cut =
    source.inputTruncated === true ? ', text cut by this call\u2019s character budget' : ''
  return `${source.ref}${type}: ${source.passages ?? 0} passages${chars}${cut}`
}

/**
 * The truncated-result message: what was omitted, what a passage costs, and
 * the call that reads the item's notes and annotations outside the budget.
 */
export const RETRIEVE_TRUNCATED_MESSAGE =
  'More evidence was available but omitted by the passage or character budget: a passage charges its text and, for an annotation, its comment.'

/** The remedy half of {@link RETRIEVE_TRUNCATED_MESSAGE}. */
export const RETRIEVE_TRUNCATED_REMEDY =
  'zotero_get with include:["notes", "annotations"] reads the item\u2019s notes and annotations outside this budget.'

/**
 * What an empty evidence list means when the semantic route ran: neither the
 * query's words nor its meaning scored any passage. The call establishes only
 * this, not that the item has nothing on the subject.
 */
export const NO_MATCH_MESSAGE =
  'No passage matched this query \u2014 neither its terms nor its meaning. That describes this query against the sources this call read; it is not evidence that the item has nothing on the subject.'

/**
 * The same fact when only the lexical route ran; no semantic comparison was
 * made because semantic ranking was off or its model did not answer.
 */
export const NO_MATCH_TERMS_ONLY_MESSAGE =
  'No passage matched this query\u2019s terms (semantic ranking was not part of this call). That describes this query against the sources this call read; it is not evidence that the item has nothing on the subject.'

/** The remedy half of {@link NO_MATCH_MESSAGE}. */
export const NO_MATCH_REMEDY =
  'Rephrase with the subject\u2019s own terms, pass queryVariants with your own paraphrases, or widen sources.'

/**
 * The message when the item offered no rankable passage at all; the overlap
 * test did not run.
 */
export const NO_SOURCES_MESSAGE =
  'This item offered no rankable passage \u2014 no annotation, note, abstract, or indexed full text \u2014 so no overlap test ran. It is not evidence about the item\u2019s content.'

/** The remedy half of {@link NO_SOURCES_MESSAGE}. */
export const NO_SOURCES_REMEDY =
  'Check that the item has an indexed attachment, or read its files directly with zotero_get.'

/**
 * Why an empty answer is expected: the query carried nothing the lexical route
 * could score.
 */
export const NO_CONTENT_TERMS_MESSAGE =
  'The query carried no content words (\u201cthe\u201d, \u201cof\u201d and the like are dropped before scoring), so there was nothing to match; ask with the subject\u2019s own terms.'

export function renderRetrieve(_args: RetrieveArgs, value: RetrieveOutput): ContentBlock[] {
  const lines = [
    `Evidence for ${value.ref} (${value.evidence.length} passage${value.evidence.length === 1 ? '' : 's'})`,
  ]
  if (value.evidence.length === 0) {
    if (value.noMatch === 'no-sources') {
      lines.push(NO_SOURCES_MESSAGE, NO_SOURCES_REMEDY)
    } else if (value.noMatch === 'no-overlap') {
      // The meaning claim is only made when the semantic route actually ran.
      lines.push(
        value.rankedRoutes?.includes('semantic') === true
          ? NO_MATCH_MESSAGE
          : NO_MATCH_TERMS_ONLY_MESSAGE,
      )
      // A termless query explains an empty answer only when the lexical route
      // was the whole call. A semantic route can legitimately return nothing
      // without any content words, so the wording claim would misexplain it.
      if (value.queryTerms.length === 0 && !value.rankedRoutes?.includes('semantic')) {
        lines.push(NO_CONTENT_TERMS_MESSAGE)
      } else {
        lines.push(NO_MATCH_REMEDY)
      }
    } else if (value.truncated) {
      // Matches existed, but the passage/character budgets omitted every one.
      // Say that; never claim "no match" alongside "more matches omitted".
      lines.push(RETRIEVE_TRUNCATED_MESSAGE, RETRIEVE_TRUNCATED_REMEDY)
    }
    // No `noMatch` and no truncation: an empty evidence list with no recorded
    // cause is not a fact we can describe, so no claim is emitted.
  }
  if (value.attachmentRef !== undefined) {
    const type =
      value.attachmentContentType === undefined ? '' : ` (${value.attachmentContentType})`
    lines.push(`Full text: ${value.attachmentRef}${type}`)
  }
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
  if (value.attachments !== undefined) {
    const total = value.attachments.length
    const silent = value.attachments.filter((source) => source.status !== 'indexed').length
    lines.push(
      `\nFull-text sources read (${total - silent} of ${total}):`,
      ...value.attachments.map((source) => `  - ${attachmentSourceLine(source)}`),
    )
    if (silent > 0) {
      lines.push(silentAttachmentsMessage(silent, total))
    }
  }
  value.evidence.forEach((entry) => {
    const page =
      entry.pageLabel === undefined ? entry.source : `${entry.source} (page ${entry.pageLabel})`
    const chunk =
      entry.chunkCount === undefined || entry.chunkIndex === undefined
        ? ''
        : `, chunk ${entry.chunkIndex + 1}/${entry.chunkCount}`
    // The ordinary case (the passage's own words carry the query) needs no
    // label. Other kinds change how the passage may be used, so they are named
    // in the bracket.
    const kind = matchSuffix(entry.matchKind)
    const comment = entry.comment === undefined ? '' : `\nComment: ${entry.comment}`
    lines.push(`\n[${page}${chunk}${kind}] ${entry.sourceRef}\n${entry.text}${comment}`)
    if (entry.matchKind === 'semantic') lines.push(SEMANTIC_ONLY_NOTE)
    if (entry.matchedFields !== undefined) {
      lines.push(matchLine(entry.matchedFields))
    }
  })
  if (value.sourcesSkipped.length > 0) {
    lines.push(`\nSkipped unavailable sources: ${value.sourcesSkipped.join(', ')}`)
  }
  // The budget message is already the whole empty-answer explanation above
  // when every match was omitted; otherwise it accompanies the passages.
  if (value.truncated && !(value.evidence.length === 0 && value.noMatch === undefined))
    lines.push(`\n${RETRIEVE_TRUNCATED_MESSAGE} ${RETRIEVE_TRUNCATED_REMEDY}`)
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * The completed retrieve card: the evidence passage count plus whether the
 * budget cut the list. `meta` is absent on nested code dispatch or malformed
 * replay records, and a failed call keeps the raw error content; both fall
 * back to the generic card.
 */
function presentRetrieveResult(
  _args: RetrieveArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (typeof record.count !== 'number') return undefined
  const truncated = record.truncated === true ? ' (truncated)' : ''
  return { card: 'generic', title: `Zotero evidence: ${record.count} passages${truncated}` }
}

/**
 * Register the `zotero_retrieve` tool. The service's live config is read per
 * request so a settings edit takes effect on the next call without
 * re-registration.
 * @param ctx - the plugin context.
 * @param service - the zotero service owning the request path.
 */
export function registerRetrieveTool(
  ctx: Context,
  service: ZoteroService,
  wrap: ToolWrapper = identityToolWrapper,
): void {
  ctx.tools.register(
    wrap(
      defineTool({
        name: 'zotero_retrieve',
        description: [
          'Gather evidence passages for one Zotero item and rank them against a query.',
          "Sources: annotations (with Zotero's own page labels), notes, the abstract, and ranked full-text chunks.",
          "An annotation ranks on its highlight and its reader comment together, and matchedFields names which of the two carried the query terms; a hit found only in the comment is the annotator's view, not the paper's text.",
          'matchKind: lexical = the passage\u2019s own text carries the query\u2019s words, semantic = only the meaning matched (never quote it as containing them), hybrid = both.',
          'queryVariants: extra phrasings of the same question; the best score per passage wins.',
          'A note item contributes its own body; child notes contribute every chunk of their full text (chunkIndex/chunkCount locate each passage).',
          "attachmentPolicy picks the fulltext sources: best (default, Zotero's chosen PDF), allIndexed (every PDF child, use when a work has several files), or specified via attachmentRefs; a specified attachment must provably be this item's own child.",
          'Unavailable sources are skipped and listed in sourcesSkipped instead of failing the call.',
          'An empty list (noMatch) means this query matched nothing on the routes reported in rankedRoutes; it is never evidence the item is silent on the subject.',
          'Results are capped by passage count and character budget: a passage charges its text and, for an annotation, its comment; a truncated flag signals omitted evidence.',
        ].join(' '),
        parameters: RETRIEVE_PARAMETERS,
        output: {
          schema: RETRIEVE_OUTPUT_SCHEMA,
          render: renderRetrieve,
          presentationMeta: (args, value) =>
            boundedPresentationMeta(projectRetrieveMeta(value, args.sources ?? ALL_SOURCES), [
              'items',
            ]),
        },
        presentCall: (args) => ({
          card: 'generic',
          kind: 'search',
          title: 'Retrieve Zotero evidence',
          rawInput: args.query,
        }),
        presentResult: presentRetrieveResult,
        isConcurrencySafe: () => true,
        async execute(args, exec) {
          return await service.retrieve(buildRequest(args, service.config), exec.signal)
        },
      }),
    ),
  )
}
