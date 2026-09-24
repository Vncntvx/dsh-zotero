/**
 * The `zotero_create_note` tool: create a research note in the personal
 * library — standalone, or a child note under a parent item — with tags,
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
import { ZOTERO_WRITE_LIST_MAX_ITEMS, ZOTERO_WRITE_NOTE_MAX_CHARS } from '../constants.js'
import {
  WRITE_CHILD_COLLECTIONS_MESSAGE,
  writeListTooLongMessage,
  writeNoteTooLongMessage,
} from '../errors.js'
import { metaRecordOf, renderDeclined } from './present.js'
import { invalid, parseSupportedRef, REF_ARG_HINT } from './validate.js'
import { askPlanApproval } from './write-approval.js'
import type { ZoteroService } from '../service.js'
import type { ZoteroCreateNoteRequest } from '../types.js'

const CREATE_NOTE_PARAMETERS = {
  markdown: {
    type: 'string',
    required: true,
    description:
      'The note body in markdown. Supported: paragraphs, # to #### headings, **bold**, *italic*, `code`, fenced code, > quotes, - and 1. lists (one nesting level), pipe tables with a |---| separator row, [text](https://… or zotero://…) links. Anything else is escaped and shown as literal text — raw HTML never passes through, so write markdown, not HTML.',
  },
  parentItem: {
    type: 'string',
    description: `A ${REF_ARG_HINT} ref the note attaches under as a child note; omit for a standalone note. A child note inherits its parent's collections.`,
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
    description: `Item ${REF_ARG_HINT} refs the note derives from; recorded as dc:relation source links and echoed in the result.`,
  },
} as const

type CreateNoteArgs = InferArgs<typeof CREATE_NOTE_PARAMETERS>

const CREATE_NOTE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['applied', 'declined'], required: true },
    ref: { type: 'string', description: 'The created note ref (provenance-qualified).' },
    key: { type: 'string' },
    version: { type: 'integer' },
    parentItem: { type: 'string', description: 'The parent ref, for a child note.' },
    collections: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    sourceRefs: { type: 'array', items: { type: 'string' } },
    libraryVersion: { type: 'integer', description: 'The library version the write advanced to.' },
    serverId: { type: 'string' },
  },
} as const

type CreateNoteOutput = InferValue<typeof CREATE_NOTE_OUTPUT_SCHEMA>

/** The deterministic plan markdown the approval card renders. */
export function createNotePlan(args: CreateNoteArgs): string {
  const preview = args.markdown.length > 400 ? `${args.markdown.slice(0, 400)}…` : args.markdown
  // buildRequest already refused non-empty collections on a child note, so a
  // planned child write never carries collections — the card must say what
  // the domain will actually do (inherit), not echo a list that cannot land.
  const collections =
    args.parentItem !== undefined
      ? '(inherited from parent item)'
      : args.collections === undefined || args.collections.length === 0
        ? '(none)'
        : args.collections.join(', ')
  return [
    '**Create a Zotero research note**',
    '- Library: zotero://user/0 (the local personal library)',
    `- Kind: ${args.parentItem === undefined ? 'standalone note' : `child note under ${args.parentItem}`}`,
    `- Collections: ${collections}`,
    `- Tags: ${args.tags === undefined || args.tags.length === 0 ? '(none)' : args.tags.join(', ')}`,
    `- Sources: ${args.sourceRefs === undefined || args.sourceRefs.length === 0 ? '(none)' : args.sourceRefs.join(', ')}`,
    `- Body preview: ${preview}`,
    'The markdown is converted to Zotero note HTML; unknown syntax is escaped, never executed.',
  ].join('\n')
}

/**
 * Turn model arguments into the domain request, refusing every combination
 * the schema cannot express. Cross-field rules live here (and again in the
 * write domain for non-tool callers) so a malformed ask fails before the
 * plan card — never after the user approved a write that cannot run.
 */
function buildRequest(args: CreateNoteArgs): ZoteroCreateNoteRequest {
  if (args.markdown.length > ZOTERO_WRITE_NOTE_MAX_CHARS) {
    invalid(writeNoteTooLongMessage(ZOTERO_WRITE_NOTE_MAX_CHARS))
  }
  const lists = [
    ['collections', args.collections],
    ['tags', args.tags],
    ['sourceRefs', args.sourceRefs],
  ] as const
  for (const [name, list] of lists) {
    if (list !== undefined && list.length > ZOTERO_WRITE_LIST_MAX_ITEMS) {
      invalid(writeListTooLongMessage(name, ZOTERO_WRITE_LIST_MAX_ITEMS))
    }
  }
  const parentItem = args.parentItem
  const collections = args.collections
  // Same constant the write domain throws — dual-end, one wording.
  if (parentItem !== undefined && collections !== undefined && collections.length > 0) {
    invalid(WRITE_CHILD_COLLECTIONS_MESSAGE)
  }
  return {
    markdown: args.markdown,
    ...(parentItem !== undefined ? { parentItem: parseSupportedRef(parentItem, ['item']) } : {}),
    // Empty list == absent: a standalone note with [] joins no collection;
    // a child note with [] inherits the parent. Both leave the request
    // without a collections key, which is what the domain applies.
    ...(collections !== undefined && collections.length > 0 ? { collections } : {}),
    ...(args.tags !== undefined ? { tags: args.tags } : {}),
    ...(args.sourceRefs !== undefined
      ? { sourceRefs: args.sourceRefs.map((ref) => parseSupportedRef(ref, ['item'])) }
      : {}),
  }
}

export function renderCreateNote(_args: CreateNoteArgs, value: CreateNoteOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  const lines = [`Created note ${value.ref} (version ${value.version}).`]
  if (value.parentItem !== undefined) lines.push(`Parent: ${value.parentItem}`)
  const collections = value.collections ?? []
  if (collections.length > 0) lines.push(`Collections: ${collections.join(', ')}`)
  const tags = value.tags ?? []
  if (tags.length > 0) lines.push(`Tags: ${tags.join(', ')}`)
  const sources = value.sourceRefs ?? []
  if (sources.length > 0) lines.push(`Sources: ${sources.join(', ')}`)
  lines.push(
    `Library version: ${value.libraryVersion}${value.serverId === undefined ? '' : ` (served by ${value.serverId})`}`,
  )
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentCreateNoteResult(
  _args: CreateNoteArgs,
  result: ToolResult,
): ToolResultView | undefined {
  const record = metaRecordOf(result)
  if (record === undefined) return undefined
  if (record.kind === 'declined') {
    return { card: 'generic', title: 'Zotero note: declined, nothing written' }
  }
  const ref = typeof record.ref === 'string' ? record.ref : ''
  return { card: 'generic', title: `Zotero note created${ref === '' ? '' : `: ${ref}`}` }
}

export function registerCreateNoteTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_create_note',
      description:
        'Create a research note in the Zotero personal library — standalone, or a child note under a parent item — with tags, collections, and source relations. The markdown body is converted to Zotero note HTML under an escape-unknown grammar (raw HTML is escaped, never executed). Collections apply to standalone notes only; a child-note call that also passes non-empty collections is refused as ZOTERO_INVALID_ARGUMENT before any plan is shown (child notes inherit their parent item\'s collections). When writeConfirm is on (the default) the write first shows a plan the user approves; Zotero itself may show its authorization dialog on first use. kind "declined" means the user answered the plan without approving and nothing was written — do not retry unasked.',
      parameters: CREATE_NOTE_PARAMETERS,
      output: {
        schema: CREATE_NOTE_OUTPUT_SCHEMA,
        render: renderCreateNote,
        presentationMeta: (_args, value): JsonValue =>
          value.kind === 'applied'
            ? {
                kind: 'applied',
                ref: value.ref ?? '',
                key: value.key ?? '',
                version: value.version ?? 0,
              }
            : { kind: 'declined' },
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Create Zotero research note',
        rawInput: args.parentItem ?? '(standalone)',
      }),
      presentResult: presentCreateNoteResult,
      async execute(args, exec) {
        // Validate before the plan card: a malformed ask should never bother
        // the user with an approval for a call that cannot run. No
        // connectivity ask wraps the write: that helper retries, and a
        // retried note creation would create the note twice.
        const request = buildRequest(args)
        if (service.config.writeConfirm) {
          const approved = await askPlanApproval(ctx, exec, createNotePlan(args))
          if (!approved) return { kind: 'declined' } as const
        }
        return await service.createNote(request, exec.signal)
      },
    }),
  )
}
