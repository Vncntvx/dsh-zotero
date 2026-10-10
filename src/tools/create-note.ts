/**
 * The `zotero_create_note` tool: create a research note in the personal
 * library, either standalone or a child note under a parent item, with tags,
 * collections, and source relations. The plan-review approval runs before
 * Zotero is contacted; the markdown body is converted to note HTML by the
 * write domain under the escape-unknown grammar.
 * @module dsh-zotero/tools/create-note
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from '../config.js'
import { WRITE_CHILD_COLLECTIONS_MESSAGE, writeNoteTooLongMessage } from '../errors.js'
import { isRefString } from '../refs.js'
import { truncateText } from '../normalize.js'
import { renderDeclined } from './present.js'
import {
  COMMITTED_UNVERIFIED_VARIANT,
  createWritePresentationMeta,
  DECLINED_OUTPUT_SCHEMA,
  libraryVersionLine,
  presentCreateResultView,
  renderCommittedUnverified,
} from './write-present.js'
import {
  assertNonBlank,
  assertWriteList,
  invalid,
  parseSupportedRef,
  parseWritableRef,
  WRITE_REF_ARG_HINT,
} from './validate.js'
import {
  WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
  WRITE_PLAN_OUTCOME_DESCRIPTION,
  WRITE_PLAN_LIBRARY_LINE,
} from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroCreateNoteOutcome, ZoteroCreateNoteRequest } from '../types.js'

const CREATE_NOTE_PARAMETERS = {
  parentItem: {
    type: 'string',
    description: `A ${WRITE_REF_ARG_HINT} ref the note attaches under as a child note; omit for a standalone note. A child note inherits its parent's collections. Provide metadata fields (parentItem, collections, tags, sourceRefs) before markdown in the arguments.`,
  },
  collections: {
    type: 'array',
    items: { type: 'string' },
    description:
      "Collections the note joins, as zotero://user/0/collection/<KEY> refs or exact names. Standalone notes only; a child-note call that also passes non-empty collections is refused (they inherit the parent item's collections).",
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Tags applied at creation.',
  },
  sourceRefs: {
    type: 'array',
    items: { type: 'string' },
    description: `Item ${WRITE_REF_ARG_HINT} refs the note derives from; recorded as dc:relation source links and echoed in the result.`,
  },
  markdown: {
    type: 'string',
    required: true,
    description:
      'The note body in markdown. Supported: paragraphs, # to #### headings, **bold**, *italic*, `code`, fenced code, > quotes, - and 1. lists (one nesting level), pipe tables with a |---| separator row, [text](https://… or zotero://…) links. Anything else is escaped and shown as literal text; raw HTML never passes through, so write markdown, not HTML.',
  },
} as const

type CreateNoteArgs = InferArgs<typeof CREATE_NOTE_PARAMETERS>

const CREATE_NOTE_OUTPUT_SCHEMA = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['applied'], required: true },
        ref: {
          type: 'string',
          required: true,
          description: 'The created note ref (provenance-qualified).',
        },
        key: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        parentItem: { type: 'string', description: 'The parent ref, for a child note.' },
        collections: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description: 'Collections the note joined; empty for a child note.',
        },
        tags: { type: 'array', items: { type: 'string' }, required: true },
        sourceRefs: { type: 'array', items: { type: 'string' }, required: true },
        libraryVersion: {
          type: 'integer',
          required: true,
          description: 'The library version the write advanced to.',
        },
        serverId: { type: 'string' },
      },
    },
    COMMITTED_UNVERIFIED_VARIANT,
  ],
} as const

type CreateNoteOutput = InferValue<typeof CREATE_NOTE_OUTPUT_SCHEMA>

/** Body characters shown on the approval card; the full markdown is what gets written. */
const NOTE_PREVIEW_CHARS = 400

/** The deterministic plan markdown the approval card renders. */
export function createNotePlan(args: CreateNoteArgs): string {
  const { text, truncated } = truncateText(args.markdown, NOTE_PREVIEW_CHARS)
  const preview = truncated ? `${text}…` : text
  // buildRequest already refused non-empty collections on a child note, so a
  // planned child write never carries collections. The card must say what the
  // domain will actually do (inherit), not echo a list that cannot land.
  const collections =
    args.parentItem !== undefined
      ? '(inherited from parent item)'
      : args.collections === undefined || args.collections.length === 0
        ? '(none)'
        : args.collections.map((collection) => collection.trim()).join(', ')
  return [
    '**Create a Zotero research note**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Kind: ${args.parentItem === undefined ? 'standalone note' : `child note under ${args.parentItem}`}`,
    `- Collections: ${collections}`,
    `- Tags: ${args.tags === undefined || args.tags.length === 0 ? '(none)' : args.tags.map((tag) => tag.trim()).join(', ')}`,
    `- Sources: ${args.sourceRefs === undefined || args.sourceRefs.length === 0 ? '(none)' : args.sourceRefs.join(', ')}`,
    `- Body preview: ${preview}`,
    'The markdown is converted to Zotero note HTML; unknown syntax is escaped, never executed.',
  ].join('\n')
}

/**
 * Turn model arguments into the domain request, refusing every combination
 * the schema cannot express. Cross-field rules live here (and again in the
 * write domain for non-tool callers) so a malformed ask fails before the
 * plan card. Collection names still resolve in the write domain after
 * approval (they are a live lookup, not a malformed-ask condition).
 */
function buildRequest(args: CreateNoteArgs, config: ResolvedConfig): ZoteroCreateNoteRequest {
  assertNonBlank('markdown', args.markdown)
  if (args.markdown.length > config.writeNoteMaxChars) {
    invalid(writeNoteTooLongMessage(config.writeNoteMaxChars))
  }
  // Bound and blank checks ride the shared assertWriteList; the ref parse
  // below stays create-note's own (collections may arrive as names).
  const collections =
    args.collections === undefined
      ? undefined
      : assertWriteList('collections', args.collections, config.writeListMaxItems).map((value) => {
          if (isRefString(value)) parseWritableRef(value, ['collection'])
          return value
        })
  const tags =
    args.tags === undefined
      ? undefined
      : assertWriteList('tags', args.tags, config.writeListMaxItems)
  const sourceRefs =
    args.sourceRefs === undefined
      ? undefined
      : assertWriteList('sourceRefs', args.sourceRefs, config.writeListMaxItems)
  const parentItem = args.parentItem
  // Same constant the write domain throws: one wording at both ends.
  if (parentItem !== undefined && collections !== undefined && collections.length > 0) {
    invalid(WRITE_CHILD_COLLECTIONS_MESSAGE)
  }
  return {
    markdown: args.markdown,
    ...(parentItem !== undefined ? { parentItem: parseWritableRef(parentItem, ['item']) } : {}),
    // Empty list == absent: a standalone note with [] joins no collection;
    // a child note with [] inherits the parent. Both leave the request
    // without a collections key, which is what the domain applies.
    ...(collections !== undefined && collections.length > 0 ? { collections } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(sourceRefs !== undefined
      ? { sourceRefs: sourceRefs.map((ref) => parseSupportedRef(ref, ['item'])) }
      : {}),
  }
}

export function renderCreateNote(_args: CreateNoteArgs, value: CreateNoteOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  if (value.kind === 'committed-unverified') {
    return renderCommittedUnverified(value, 'note', 'committed')
  }
  const lines = [`Created note ${value.ref} (version ${value.version}).`]
  if (value.parentItem !== undefined) lines.push(`Parent: ${value.parentItem}`)
  if (value.collections.length > 0) lines.push(`Collections: ${value.collections.join(', ')}`)
  if (value.tags.length > 0) lines.push(`Tags: ${value.tags.join(', ')}`)
  if (value.sourceRefs.length > 0) lines.push(`Sources: ${value.sourceRefs.join(', ')}`)
  lines.push(libraryVersionLine(value))
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentCreateNoteResult(
  _args: CreateNoteArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentCreateResultView('note', 'committed', result)
}

export function registerCreateNoteTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_create_note',
      description:
        "Create a research note in the Zotero personal library, either standalone or a child note under a parent item, with tags, collections, and source relations. The markdown body is converted to Zotero note HTML under an escape-unknown grammar (raw HTML is escaped, never executed). Collections apply to standalone notes only; a child-note call that also passes non-empty collections is refused as ZOTERO_INVALID_ARGUMENT before any plan is shown (child notes inherit their parent item's collections). Zotero itself may show its authorization dialog on first use. " +
        WRITE_PLAN_OUTCOME_DESCRIPTION +
        WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
      parameters: CREATE_NOTE_PARAMETERS,
      output: {
        schema: CREATE_NOTE_OUTPUT_SCHEMA,
        render: renderCreateNote,
        presentationMeta: (_args, value): JsonValue => createWritePresentationMeta(value),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Create Zotero research note',
        rawInput: args.parentItem ?? '(standalone)',
      }),
      presentResult: presentCreateNoteResult,
      // timeoutMs is deliberately omitted: the plan-review card waits on user
      // think time, which is not a stuck request.
      async execute(args, exec): Promise<ZoteroCreateNoteOutcome> {
        // Validate before the plan: a malformed ask should never bother the
        // user with an approval for a call that cannot run. The plan review
        // itself is the seam's (service.createNote), so no caller can skip it.
        // No connectivity ask wraps the write: that helper retries, and a
        // retried note creation would create the note twice.
        const request = buildRequest(args, service.config)
        return await service.createNote(request, { exec, plan: createNotePlan(args) })
      },
    }),
  )
}
