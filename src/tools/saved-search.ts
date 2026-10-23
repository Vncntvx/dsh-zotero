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
  COMMITTED_UNVERIFIED_VARIANT,
  DECLINED_OUTPUT_SCHEMA,
  createWritePresentationMeta,
  libraryVersionLine,
  presentCreateResultView,
  presentDeleteResultView,
  presentUpdateResultView,
  renderCommittedUnverified,
} from './write-present.js'
import { assertNonBlank, parseWritableRef, WRITE_SEARCH_REF_ARG_HINT } from './validate.js'
import {
  WRITE_PLAN_LIBRARY_LINE,
  WRITE_PLAN_OUTCOME_DESCRIPTION,
  WRITE_COMMITTED_UNVERIFIED_DESCRIPTION,
} from '../write-approval.js'
import type { ZoteroService } from '../service.js'
import type {
  ZoteroCreateSavedSearchRequest,
  ZoteroUpdateSavedSearchRequest,
  ZoteroDeleteSavedSearchRequest,
} from '../types.js'

const CONDITION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    condition: { type: 'string', required: true },
    operator: { type: 'string', required: true },
    value: { type: 'string', required: true },
  },
} as const
const CREATE = {
  name: { type: 'string', required: true },
  conditions: { type: 'array', required: true, items: CONDITION },
} as const
const UPDATE = {
  search: {
    type: 'string',
    required: true,
    description: `A ${WRITE_SEARCH_REF_ARG_HINT} ref.`,
  },
  name: { type: 'string' },
  conditions: { type: 'array', items: CONDITION },
} as const
const DELETE = {
  search: { type: 'string', required: true, description: `A ${WRITE_SEARCH_REF_ARG_HINT} ref.` },
} as const
/** The applied shape the create and update outcomes share. */
const APPLIED = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    kind: { type: 'string' as const, enum: ['applied'] as const, required: true },
    ref: { type: 'string' as const, required: true },
    key: { type: 'string' as const, required: true },
    version: { type: 'integer' as const, required: true },
    name: { type: 'string' as const },
    conditions: { type: 'array' as const, items: CONDITION },
    libraryVersion: { type: 'integer' as const, required: true },
    serverId: { type: 'string' as const },
  },
} as const
/** The deleted shape the delete outcome carries. */
const DELETED = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    kind: { type: 'string' as const, enum: ['deleted'] as const, required: true },
    ref: { type: 'string' as const, required: true },
    key: { type: 'string' as const, required: true },
    deleted: { type: 'boolean' as const, enum: [true], required: true },
    libraryVersion: { type: 'integer' as const, required: true },
    serverId: { type: 'string' as const },
  },
} as const
const CREATED = { oneOf: [DECLINED_OUTPUT_SCHEMA, COMMITTED_UNVERIFIED_VARIANT, APPLIED] } as const
const UPDATE_OUTPUT = { oneOf: [DECLINED_OUTPUT_SCHEMA, APPLIED] } as const
const DELETE_OUTPUT = { oneOf: [DECLINED_OUTPUT_SCHEMA, DELETED] } as const
type CreateArgs = InferArgs<typeof CREATE>
type UpdateArgs = InferArgs<typeof UPDATE>
type DeleteArgs = InferArgs<typeof DELETE>
type CreatedOutput = InferValue<typeof CREATED>
type UpdateOutput = InferValue<typeof UPDATE_OUTPUT>
type DeleteOutput = InferValue<typeof DELETE_OUTPUT>
type AnyOutput = CreatedOutput | UpdateOutput | DeleteOutput

const render = (_args: unknown, value: AnyOutput): ContentBlock[] => {
  if (value.kind === 'declined') return renderDeclined()
  if (value.kind === 'committed-unverified')
    return renderCommittedUnverified(value, 'saved search', 'created')
  return [
    {
      type: 'text',
      text: [
        `Zotero saved-search operation ${value.kind === 'deleted' ? 'completed' : 'applied'} for ${value.ref ?? value.key ?? 'the requested search'}.`,
        ...(value.libraryVersion === undefined ? [] : [libraryVersionLine(value)]),
      ].join('\n'),
    },
  ]
}

/** Replayable projection for the update arm: the applied identity. */
function presentUpdateMeta(_args: UpdateArgs, value: UpdateOutput): JsonValue {
  if (value.kind === 'declined') return { kind: 'declined' }
  return {
    kind: 'applied',
    ref: value.ref,
    key: value.key,
    version: value.version,
    ...(value.libraryVersion === undefined ? {} : { libraryVersion: value.libraryVersion }),
  }
}

/** Replayable projection for the delete arm: the deleted identity. */
function presentDeleteMeta(_args: DeleteArgs, value: DeleteOutput): JsonValue {
  if (value.kind === 'declined') return { kind: 'declined' }
  return {
    kind: 'deleted',
    ref: value.ref,
    key: value.key,
    ...(value.libraryVersion === undefined ? {} : { libraryVersion: value.libraryVersion }),
  }
}

function presentUpdateResult(_args: UpdateArgs, result: ToolResult): ToolResultView | undefined {
  return presentUpdateResultView('saved search', result)
}

function presentDeleteResult(_args: DeleteArgs, result: ToolResult): ToolResultView | undefined {
  return presentDeleteResultView('saved search delete', 'saved search', result)
}

function presentCreateResult(_args: CreateArgs, result: ToolResult): ToolResultView | undefined {
  return presentCreateResultView('saved search', 'created', result)
}

export function registerSavedSearchTools(ctx: Context, service: ZoteroService): Array<() => void> {
  const create = ctx.tools.register(
    defineTool({
      name: 'zotero_create_saved_search',
      description: `Create a Zotero saved search with explicit conditions. ${WRITE_PLAN_OUTCOME_DESCRIPTION} ${WRITE_COMMITTED_UNVERIFIED_DESCRIPTION}`,
      parameters: CREATE,
      output: {
        schema: CREATED,
        render,
        presentationMeta: (_args, value): JsonValue => createWritePresentationMeta(value),
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Create Zotero saved search',
        rawInput: args.name,
      }),
      presentResult: presentCreateResult,
      async execute(args, exec): Promise<CreatedOutput> {
        // Validate before the plan: a blank name is a refusal, not something
        // the user approves a plan for. The domain keeps its own guard; this
        // is the tool-layer fail-fast every other write tool keeps.
        const name = assertNonBlank('name', args.name)
        const request: ZoteroCreateSavedSearchRequest = { name, conditions: args.conditions }
        return await service.createSavedSearch(request, {
          exec,
          plan: [
            '**Create a Zotero saved search**',
            WRITE_PLAN_LIBRARY_LINE,
            `- Name: ${name}`,
            `- Conditions: ${args.conditions.length}`,
          ].join('\n'),
        })
      },
    }),
  )
  const update = ctx.tools.register(
    defineTool({
      name: 'zotero_update_saved_search',
      description: `Update a Zotero saved search name or conditions. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
      parameters: UPDATE,
      output: {
        schema: UPDATE_OUTPUT,
        render,
        presentationMeta: presentUpdateMeta,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Update Zotero saved search',
        rawInput: args.search,
      }),
      presentResult: presentUpdateResult,
      async execute(args, exec): Promise<UpdateOutput> {
        const request: ZoteroUpdateSavedSearchRequest = {
          search: parseWritableRef(args.search, ['search']),
          ...(args.name === undefined ? {} : { name: assertNonBlank('name', args.name) }),
          ...(args.conditions === undefined ? {} : { conditions: args.conditions }),
        }
        return await service.updateSavedSearch(request, {
          exec,
          plan: [
            '**Update a Zotero saved search**',
            WRITE_PLAN_LIBRARY_LINE,
            `- Search: ${args.search}`,
            ...(args.name === undefined ? [] : [`- Name: ${args.name.trim()}`]),
            ...(args.conditions === undefined ? [] : [`- Conditions: ${args.conditions.length}`]),
          ].join('\n'),
        })
      },
    }),
  )
  const remove = ctx.tools.register(
    defineTool({
      name: 'zotero_delete_saved_search',
      description: `Delete a Zotero saved search. ${WRITE_PLAN_OUTCOME_DESCRIPTION}`,
      parameters: DELETE,
      output: {
        schema: DELETE_OUTPUT,
        render,
        presentationMeta: presentDeleteMeta,
      },
      presentCall: (args) => ({
        card: 'generic',
        kind: 'edit',
        title: 'Delete Zotero saved search',
        rawInput: args.search,
      }),
      presentResult: presentDeleteResult,
      async execute(args, exec): Promise<DeleteOutput> {
        const request: ZoteroDeleteSavedSearchRequest = {
          search: parseWritableRef(args.search, ['search']),
        }
        return await service.deleteSavedSearch(request, {
          exec,
          plan: [
            '**Delete a Zotero saved search**',
            WRITE_PLAN_LIBRARY_LINE,
            `- Search: ${args.search}`,
            'This removes the saved-search definition; library items are unchanged.',
          ].join('\n'),
        })
      },
    }),
  )
  return [create, update, remove]
}
