import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
  type ScholarlyToolHost,
  type ScholarlyToolOutput,
} from './search.js'
import type { ZoteroCreateItemRequest } from '../../types.js'
import { requireCreatableItemType, normalizeCreator } from '../../write-item-rules.js'

export function createScholarlySaveToZoteroTool(host: ScholarlyToolHost): ToolDefinition {
  return defineTool({
    name: 'scholarly_save_to_zotero',
    description:
      'Save one scholarly result into the local Zotero personal library through the normal write approval seam. The local Zotero component and writeEnabled must both be active.',
    parameters: {
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
    },
    output: SCHOLARLY_TEXT_OUTPUT_DESCRIPTOR,
    isConcurrencySafe: () => false,
    timeoutMs: 120_000,
    async execute(args, exec): Promise<ScholarlyToolOutput> {
      const service = host.zoteroService?.()
      if (service?.createItem === undefined)
        throw new Error('The local Zotero write component is unavailable or disabled.')
      const input = args as {
        itemType?: string
        title: string
        authors?: string[]
        year?: number
        doi?: string
        url?: string
        abstract?: string
        publicationTitle?: string
        tags?: string[]
        collections?: string[]
      }
      const itemType = requireCreatableItemType(input.itemType ?? 'journalArticle')
      const creators = (input.authors ?? []).map((name, index) => {
        const pieces = name.trim().split(/\s+/)
        return normalizeCreator(
          {
            creatorType: index === 0 ? 'author' : 'author',
            ...(pieces.length > 1
              ? { firstName: pieces.slice(0, -1).join(' '), lastName: pieces.at(-1)! }
              : { name: pieces[0] ?? '' }),
          },
          index,
        )
      })
      const request: ZoteroCreateItemRequest = {
        itemType,
        title: input.title.trim(),
        ...(input.url ? { url: input.url.trim() } : {}),
        ...(input.year ? { date: String(input.year) } : {}),
        ...(input.doi ? { doi: input.doi.trim() } : {}),
        ...(input.abstract ? { abstractNote: input.abstract } : {}),
        ...(input.publicationTitle ? { publicationTitle: input.publicationTitle } : {}),
        ...(creators.length ? { creators } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.collections ? { collections: input.collections } : {}),
      }
      const result = await service.createItem(request, {
        exec,
        plan: [
          '**Save scholarly result to Zotero**',
          '- Personal library: zotero://user/0/',
          `- Title: ${request.title}`,
          `- DOI: ${request.doi ?? '(none)'}`,
          `- Authors: ${creators.length}`,
          `- Tags: ${(request.tags ?? []).join(', ') || '(none)'}`,
          `- Collections: ${(request.collections ?? []).join(', ') || '(none)'}`,
        ].join('\n'),
      })
      return {
        text:
          result.kind === 'declined'
            ? 'The Zotero save was declined.'
            : result.kind === 'committed-unverified'
              ? 'The Zotero save may have committed; do not retry. Reconcile by key/ref.'
              : `Saved scholarly result to Zotero as ${result.ref}.`,
        ...(result.kind === 'applied'
          ? {
              papers: [
                {
                  ref: result.ref,
                  key: result.key,
                  ...(request.title === undefined ? {} : { title: request.title }),
                  ...(request.doi === undefined ? {} : { doi: request.doi }),
                },
              ] as unknown as Record<string, import('@deepseek-ai/dsh-util-values').JsonValue>[],
            }
          : {}),
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Save scholarly result to Zotero',
      rawInput: String((args as { title?: string }).title ?? ''),
      kind: 'edit',
    }),
  })
}
