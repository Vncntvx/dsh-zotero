import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  defineTool,
  type InferArgs,
  type InferValue,
  type ToolResult,
  type ToolResultView,
} from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { renderDeclined } from './present.js'
import {
  APPLIED_ENVELOPE_PROPERTIES,
  DECLINED_OUTPUT_SCHEMA,
  COMMITTED_UNVERIFIED_VARIANT,
  createWritePresentationMeta,
  libraryVersionLine,
  presentUpdateResultView,
  renderCommittedUnverified,
} from './write-present.js'
import { NOTE_MARKDOWN_PARAMETER_DESCRIPTION } from './note-markdown.js'
import { parseWritableRef, assertNoteMarkdown, WRITE_REF_ARG_HINT } from './validate.js'
import { WRITE_PLAN_LIBRARY_LINE, WRITE_PLAN_OUTCOME_DESCRIPTION } from '../write-approval.js'
import { planValue, planBlock } from '../write-plan.js'
import type { ZoteroService } from '../service.js'
import { assertWritePayload } from './write-bounds.js'
import type { ZoteroUpdateNoteOutcome, ZoteroUpdateNoteRequest } from '../types.js'

const PARAMETERS = {
  ref: {
    type: 'string',
    required: true,
    description: `A ${WRITE_REF_ARG_HINT} ref for an existing note.`,
  },
  markdown: {
    type: 'string',
    required: true,
    description: NOTE_MARKDOWN_PARAMETER_DESCRIPTION,
  },
} as const
type Args = InferArgs<typeof PARAMETERS>
const OUTPUT = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    COMMITTED_UNVERIFIED_VARIANT,
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...APPLIED_ENVELOPE_PROPERTIES,
        libraryVersion: { type: 'integer', required: true },
      },
    },
  ],
} as const
type Output = InferValue<typeof OUTPUT>

export function updateNotePlan(args: Args): string {
  return [
    '**Update a Zotero note**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Note: ${planValue(args.ref)}`,
    '- Complete Markdown body:',
    planBlock(args.markdown),
    'The body is converted to Zotero note HTML before the versioned PATCH.',
  ].join('\n')
}

function renderUpdateNote(_args: Args, value: Output): ContentBlock[] {
  if (value.kind === 'declined') return renderDeclined()
  if (value.kind === 'committed-unverified')
    return renderCommittedUnverified(value, 'note', 'committed')
  return [
    {
      type: 'text',
      text: [
        `Updated note ${value.ref} (version ${value.version}).`,
        libraryVersionLine(value),
      ].join('\n'),
    },
  ]
}

/** Replayable projection: the applied note identity, or the declined fact. */
function presentUpdateNoteMeta(_args: Args, value: Output): JsonValue {
  if (value.kind === 'declined') return { kind: 'declined' }
  if (value.kind === 'committed-unverified') return createWritePresentationMeta(value)
  return {
    kind: 'applied',
    ref: value.ref,
    version: value.version,
    libraryVersion: value.libraryVersion,
  }
}

function presentUpdateNoteResult(_args: Args, result: ToolResult): ToolResultView | undefined {
  return presentUpdateResultView('note', result)
}

export function registerUpdateNoteTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_update_note',
      description: `Replace an existing Zotero note body with markdown under a version precondition. The target must be a note item; a non-note ref fails with ZOTERO_INVALID_ARGUMENT. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
      parameters: PARAMETERS,
      output: {
        schema: OUTPUT,
        render: renderUpdateNote,
        presentationMeta: presentUpdateNoteMeta,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Update Zotero note',
        rawInput: args.ref,
      }),
      presentResult: presentUpdateNoteResult,
      async execute(args, exec): Promise<ZoteroUpdateNoteOutcome> {
        assertWritePayload(
          args,
          Math.max(service.config.writeFieldMaxChars, service.config.writeNoteMaxChars),
        )
        const request: ZoteroUpdateNoteRequest = {
          item: parseWritableRef(args.ref, ['item']),
          markdown: assertNoteMarkdown(args.markdown, service.config.writeNoteMaxChars),
        }
        return await service.updateNote(request, { exec, plan: updateNotePlan(args) })
      },
    }),
  )
}
