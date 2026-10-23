import { defineTool, type InferValue, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ScholarlyToolHost } from './search.js'
import type { ZoteroCreateItemRequest } from '../../types.js'
import { requireCreatableItemType, normalizeCreator } from '../../write-item-rules.js'
import { WRITE_PLAN_LIBRARY_LINE } from '../../write-approval.js'
import { renderDeclined } from '../../tools/present.js'
import {
  COMMITTED_UNVERIFIED_VARIANT,
  CREATED_ITEM_VARIANT,
  DECLINED_OUTPUT_SCHEMA,
  createWritePresentationMeta,
  libraryVersionLine,
  presentCreateResultView,
  renderCommittedUnverified,
} from '../../tools/write-present.js'

const OUTPUT = {
  oneOf: [
    DECLINED_OUTPUT_SCHEMA,
    COMMITTED_UNVERIFIED_VARIANT,
    {
      ...CREATED_ITEM_VARIANT,
      properties: {
        ...CREATED_ITEM_VARIANT.properties,
        papers: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'string', required: true },
              key: { type: 'string', required: true },
              title: { type: 'string' },
              doi: { type: 'string' },
            },
          },
        },
      },
    },
  ],
} as const
type SaveOutput = InferValue<typeof OUTPUT>

const PARAMETERS = {
  itemType: { type: 'string', default: 'journalArticle' },
  title: { type: 'string', required: true },
  authors: { type: 'array', items: { type: 'string' } },
  year: { type: 'integer' },
  doi: { type: 'string' },
  url: { type: 'string' },
  abstract: { type: 'string' },
  publicationTitle: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  collections: { type: 'array', items: { type: 'string' } },
} as const

export function renderScholarlySave(_args: unknown, value: SaveOutput) {
  if (value.kind === 'declined') return renderDeclined()
  if (value.kind === 'committed-unverified')
    return renderCommittedUnverified(value, 'item', 'created')
  return [
    {
      type: 'text' as const,
      text: [
        `Saved scholarly result to Zotero as ${value.ref} (key ${value.key}; version ${value.version}).`,
        ...value.papers.flatMap((paper) => [
          ...(paper.title === undefined ? [] : [`Title: ${paper.title}`]),
          ...(paper.doi === undefined ? [] : [`DOI: ${paper.doi}`]),
        ]),
        `Tags: ${value.tags?.join(', ') || '(none)'}`,
        `Collections: ${value.collections?.join(', ') || '(none)'}`,
        libraryVersionLine(value),
      ].join('\n'),
    },
  ]
}

export function createScholarlySaveToZoteroTool(host: ScholarlyToolHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_save_to_zotero',
    description:
      'Save one scholarly result into the local Zotero personal library through the normal write approval seam. The local Zotero component and writeEnabled must both be active.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT,
      render: renderScholarlySave,
      presentationMeta: (_args, value) => createWritePresentationMeta(value),
    },
    presentResult: (_args, result) => presentCreateResultView('scholarly item', 'created', result),
    isConcurrencySafe: () => false,
    timeoutMs: 120_000,
    async execute(args, exec): Promise<SaveOutput> {
      const service = host.zoteroService?.()
      if (service?.createItem === undefined)
        throw new Error('The local Zotero write component is unavailable or disabled.')
      const itemType = requireCreatableItemType(args.itemType ?? 'journalArticle')
      const creators = (args.authors ?? []).map((name, index) => {
        const pieces = name.trim().split(/\s+/)
        return normalizeCreator(
          {
            creatorType: 'author',
            ...(pieces.length > 1
              ? { firstName: pieces.slice(0, -1).join(' '), lastName: pieces.at(-1)! }
              : { name: pieces[0] ?? '' }),
          },
          index,
        )
      })
      const request: ZoteroCreateItemRequest = {
        itemType,
        title: args.title.trim(),
        ...(args.url ? { url: args.url.trim() } : {}),
        ...(args.year ? { date: String(args.year) } : {}),
        ...(args.doi ? { doi: args.doi.trim() } : {}),
        ...(args.abstract ? { abstractNote: args.abstract } : {}),
        ...(args.publicationTitle ? { publicationTitle: args.publicationTitle } : {}),
        ...(creators.length ? { creators } : {}),
        ...(args.tags ? { tags: args.tags } : {}),
        ...(args.collections ? { collections: args.collections } : {}),
      }
      const result = await service.createItem(request, {
        exec,
        plan: [
          '**Save scholarly result to Zotero**',
          WRITE_PLAN_LIBRARY_LINE,
          `- Title: ${request.title}`,
          `- DOI: ${request.doi ?? '(none)'}`,
          `- Authors: ${creators.length}`,
          `- Tags: ${(request.tags ?? []).join(', ') || '(none)'}`,
          `- Collections: ${(request.collections ?? []).join(', ') || '(none)'}`,
        ].join('\n'),
      })
      if (result.kind !== 'applied') return result
      return {
        ...result,
        papers: [
          {
            ref: result.ref,
            key: result.key,
            ...(request.title === undefined ? {} : { title: request.title }),
            ...(request.doi === undefined ? {} : { doi: request.doi }),
          },
        ],
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Save scholarly result to Zotero',
      rawInput: args.title ?? '',
      kind: 'edit',
    }),
  })
}
