/**
 * The `zotero_batch_items` tool: execute batch item operations (create/import,
 * update tags/collections, delete) in a single reviewed plan card.
 * Previews blast radius for deletes before approval; executes creates via
 * native POST batch and updates/deletes sequentially under version preconditions.
 * @module dsh-zotero/tools/batch-items
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
import {
  normalizeCreator,
  requireCreatableItemType,
  requireTitleOrUrl,
} from '../write-item-rules.js'
import { runPreview } from './degradable.js'
import { renderDeclined } from './present.js'
import {
  BATCH_ITEMS_OUTPUT_SCHEMA,
  libraryVersionLine,
  presentBatchItemsResultView,
} from './write-present.js'
import { assertNonBlank, parseWritableRef, WRITE_REF_ARG_HINT } from './validate.js'
import { parseRef } from '../refs.js'
import { WRITE_PLAN_OUTCOME_DESCRIPTION, WRITE_PLAN_LIBRARY_LINE } from '../write-approval.js'
import {
  WRITE_LIST_SELECTION_MESSAGE,
  writeListTooLongMessage,
  ZOTERO_INVALID_ARGUMENT,
  ZoteroError,
} from '../errors.js'
import type { ZoteroService } from '../service.js'
import type {
  ZoteroBatchItemsOutcome,
  ZoteroBatchItemsRequest,
  ZoteroBatchCreateItemInput,
  ZoteroBatchUpdateItemInput,
} from '../types.js'

const BATCH_ITEMS_PARAMETERS = {
  create: {
    type: 'array',
    description: 'Items to create or import into the personal library.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        itemType: {
          type: 'string',
          required: true,
          description:
            'The Zotero item type: webpage, journalArticle, book, conferencePaper, report, thesis, document, or preprint.',
        },
        title: { type: 'string', description: 'Item title. At least title or url is required.' },
        url: { type: 'string', description: 'Item URL. At least title or url is required.' },
        date: { type: 'string', description: 'Publication date.' },
        doi: { type: 'string', description: 'DOI.' },
        abstractNote: { type: 'string', description: 'Abstract.' },
        publicationTitle: { type: 'string', description: 'Venue or journal title.' },
        creators: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              creatorType: { type: 'string', required: true },
              name: { type: 'string' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
            },
          },
          description: 'Creators.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to attach on creation.',
        },
        collections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Collections to add the new item to (refs or exact names).',
        },
      },
    },
  },
  update: {
    type: 'array',
    description: 'Existing items whose tags or collection memberships should be updated.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref: {
          type: 'string',
          required: true,
          description: `A ${WRITE_REF_ARG_HINT} ref whose tags or collections change.`,
        },
        addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add.' },
        removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove.' },
        addCollections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Collections to add (refs or exact names).',
        },
        removeCollections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Collections to remove (refs or exact names).',
        },
      },
    },
  },
  delete: {
    type: 'array',
    items: { type: 'string' },
    description: `Refs of items to delete (move to Trash). Each must be a ${WRITE_REF_ARG_HINT} ref.`,
  },
} as const

type BatchItemsArgs = InferArgs<typeof BATCH_ITEMS_PARAMETERS>
type BatchItemsOutput = InferValue<typeof BATCH_ITEMS_OUTPUT_SCHEMA>

export interface DeleteItemPreview {
  readonly ref: string
  readonly title?: string
  readonly childCount?: number
}

/**
 * The deterministic plan markdown the approval card renders.
 *
 * Kept to the Markdown subset the host renders: its plan view escapes raw
 * HTML to literal text, so a `<details>` collapse would show up as tags
 * rather than a fold. Folding is the host's job — the conversation card shows
 * the first line and first paragraph, the sidebar shows the whole document.
 * @param args - the requested operations.
 * @param deletePreviews - the read-back preview for each deletion target.
 * @returns the plan markdown.
 */
export function batchItemsPlan(
  args: BatchItemsArgs,
  deletePreviews: readonly DeleteItemPreview[] = [],
): string {
  const creates = args.create ?? []
  const updates = args.update ?? []
  const deletes = args.delete ?? []
  const total = creates.length + updates.length + deletes.length

  const lines = [
    '**Batch item operations**',
    WRITE_PLAN_LIBRARY_LINE,
    `- Total operations: ${total} (${deletes.length} to delete, ${creates.length} to create, ${updates.length} to update)`,
  ]

  // Section 1: Deletions
  if (deletes.length > 0) {
    const noun = deletes.length === 1 ? 'item' : 'items'
    lines.push(
      '',
      `### Deletions (${deletes.length} ${noun})`,
      '> Items and all descendants (notes, attachments and annotations) are moved to Zotero Trash. The preview count covers notes and attachments; annotations are not included in that count. Partial completion is reported if any object fails.',
    )
    for (const delRef of deletes) {
      const p = deletePreviews.find((entry) => entry.ref === delRef)
      const titleStr = p?.title !== undefined ? ` "${p.title}"` : ''
      const childStr =
        p?.childCount !== undefined
          ? ` (${p.childCount} ${p.childCount === 1 ? 'note/attachment' : 'notes/attachments'})`
          : ''
      lines.push(`- \`${delRef}\`:${titleStr}${childStr}`)
    }
  }

  // Section 2: Creations
  if (creates.length > 0) {
    const noun = creates.length === 1 ? 'item' : 'items'
    lines.push('', `### Create items (${creates.length} ${noun})`)
    for (const [index, c] of creates.entries()) {
      // Encode every supplied field in a fenced JSON block. A fence longer
      // than any backtick run in the data keeps user text inside the block.
      const json = JSON.stringify(c, null, 2)
      const fence = '`'.repeat(
        Math.max(3, ...[...json.matchAll(/`+/g)].map((match) => match[0].length + 1)),
      )
      lines.push('', `#### Create index ${index}`, '', `${fence}json`, json, fence)
    }
  }

  // Section 3: Updates
  if (updates.length > 0) {
    const noun = updates.length === 1 ? 'item' : 'items'
    lines.push('', `### Update items (${updates.length} ${noun})`)
    const allAddTags = new Set(updates.flatMap((u) => u.addTags ?? []))
    const allRemoveTags = new Set(updates.flatMap((u) => u.removeTags ?? []))
    const allAddCols = new Set(updates.flatMap((u) => u.addCollections ?? []))
    const allRemoveCols = new Set(updates.flatMap((u) => u.removeCollections ?? []))

    if (allAddTags.size > 0) lines.push(`- Tags to add: ${[...allAddTags].join(', ')}`)
    if (allRemoveTags.size > 0) lines.push(`- Tags to remove: ${[...allRemoveTags].join(', ')}`)
    if (allAddCols.size > 0) lines.push(`- Collections to join: ${[...allAddCols].join(', ')}`)
    if (allRemoveCols.size > 0)
      lines.push(`- Collections to leave: ${[...allRemoveCols].join(', ')}`)

    lines.push('')
    for (const u of updates) {
      const parts: string[] = []
      if (u.addTags && u.addTags.length > 0) parts.push(`+tags: ${u.addTags.join(', ')}`)
      if (u.removeTags && u.removeTags.length > 0) parts.push(`-tags: ${u.removeTags.join(', ')}`)
      if (u.addCollections && u.addCollections.length > 0)
        parts.push(`+col: ${u.addCollections.join(', ')}`)
      if (u.removeCollections && u.removeCollections.length > 0)
        parts.push(`-col: ${u.removeCollections.join(', ')}`)
      lines.push(`- \`${u.ref}\`: ${parts.join('; ')}`)
    }
  }

  lines.push(
    '',
    'Updates and moves to Trash use version preconditions; creates are sent once in one native batch. Unmentioned properties are preserved.',
  )
  return lines.join('\n')
}

export function buildBatchItemsRequest(
  args: BatchItemsArgs,
  config: ResolvedConfig,
): ZoteroBatchItemsRequest {
  const creates = args.create ?? []
  const updates = args.update ?? []
  const deletes = args.delete ?? []
  const total = creates.length + updates.length + deletes.length

  if (total === 0) {
    throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
  }
  if (total > config.writeListMaxItems) {
    throw new ZoteroError(
      writeListTooLongMessage('batch items', config.writeListMaxItems),
      ZOTERO_INVALID_ARGUMENT,
    )
  }

  const validatedDeletes = deletes.map((ref) => {
    return parseWritableRef(assertNonBlank('delete item', ref), ['item'])
  })

  const validatedUpdates: ZoteroBatchUpdateItemInput[] = updates.map((u) => {
    const ref = parseWritableRef(assertNonBlank('update item ref', u.ref), ['item'])
    const addTags = u.addTags?.map((t) => assertNonBlank('addTags', t))
    const removeTags = u.removeTags?.map((t) => assertNonBlank('removeTags', t))
    const addCols = u.addCollections?.map((c) => assertNonBlank('addCollections', c))
    const removeCols = u.removeCollections?.map((c) => assertNonBlank('removeCollections', c))
    if (
      (!addTags || addTags.length === 0) &&
      (!removeTags || removeTags.length === 0) &&
      (!addCols || addCols.length === 0) &&
      (!removeCols || removeCols.length === 0)
    ) {
      throw new ZoteroError(WRITE_LIST_SELECTION_MESSAGE, ZOTERO_INVALID_ARGUMENT)
    }
    return {
      ref,
      ...(addTags && addTags.length > 0 ? { addTags } : {}),
      ...(removeTags && removeTags.length > 0 ? { removeTags } : {}),
      ...(addCols && addCols.length > 0 ? { addCollections: addCols } : {}),
      ...(removeCols && removeCols.length > 0 ? { removeCollections: removeCols } : {}),
    }
  })

  const validatedCreates: ZoteroBatchCreateItemInput[] = creates.map((c) => {
    const itemType = requireCreatableItemType(assertNonBlank('itemType', c.itemType))
    const title = c.title?.trim() ?? ''
    const url = c.url?.trim() ?? ''
    requireTitleOrUrl(title, url)
    const creators = c.creators?.map((creator, index) => normalizeCreator(creator, index))
    const tags = c.tags?.map((t) => assertNonBlank('tags', t))
    const collections = c.collections?.map((col) => assertNonBlank('collections', col))
    return {
      itemType,
      ...(title !== '' ? { title } : {}),
      ...(url !== '' ? { url } : {}),
      ...(c.date ? { date: assertNonBlank('date', c.date) } : {}),
      ...(c.doi ? { doi: assertNonBlank('doi', c.doi) } : {}),
      ...(c.abstractNote ? { abstractNote: assertNonBlank('abstractNote', c.abstractNote) } : {}),
      ...(c.publicationTitle
        ? { publicationTitle: assertNonBlank('publicationTitle', c.publicationTitle) }
        : {}),
      ...(creators && creators.length > 0 ? { creators } : {}),
      ...(tags && tags.length > 0 ? { tags } : {}),
      ...(collections && collections.length > 0 ? { collections } : {}),
    }
  })

  return {
    ...(validatedCreates.length > 0 ? { create: validatedCreates } : {}),
    ...(validatedUpdates.length > 0 ? { update: validatedUpdates } : {}),
    ...(validatedDeletes.length > 0 ? { delete: validatedDeletes } : {}),
  }
}

async function fetchDeletePreview(
  service: ZoteroService,
  refStr: string,
  signal: AbortSignal | undefined,
): Promise<DeleteItemPreview> {
  return await runPreview(signal, { ref: refStr }, async (): Promise<DeleteItemPreview> => {
    const parsed = parseRef(refStr)
    const detail = await service.get(
      { ref: parsed, include: new Set(['attachments', 'notes']) },
      signal,
    )
    const childCount =
      detail.attachments !== undefined || detail.notes !== undefined
        ? (detail.attachments?.total ?? 0) + (detail.notes?.total ?? 0)
        : undefined
    return { ref: refStr, title: detail.title, childCount }
  })
}

export async function previewBatchItems(
  service: ZoteroService,
  deletes: readonly string[] = [],
  signal: AbortSignal | undefined,
): Promise<DeleteItemPreview[]> {
  if (deletes.length === 0) return []
  return await Promise.all(deletes.map((ref) => fetchDeletePreview(service, ref, signal)))
}

function renderBatchItems(_args: BatchItemsArgs, value: BatchItemsOutput): ContentBlock[] {
  if (value.kind === 'declined') {
    return renderDeclined()
  }
  const lines = [
    `Batch items applied: ${value.created.length} created, ${value.updated.length} updated, ${value.deleted.length} trashed.`,
  ]
  if (value.created.length > 0) {
    lines.push(
      'Created items:',
      ...value.created.map(
        (item) =>
          `- index ${item.index}: ${item.ref} (key ${item.key}) [${item.itemType}]${item.title === undefined ? '' : ` ${item.title}`}${item.url === undefined ? '' : ` URL: ${item.url}`} (version ${item.version})`,
      ),
    )
  }
  const unchangedCount = value.updated.filter((u) => u.unchanged).length
  if (unchangedCount > 0) {
    lines.push(`(${unchangedCount} of ${value.updated.length} updates resulted in no change).`)
  }
  if (value.failed.length > 0) {
    lines.push(
      `Failed operations (${value.failed.length}):`,
      ...value.failed.map(
        (f) =>
          `- [${f.op}] ${f.ref ?? `index ${f.index}`}: ${f.code} - ${f.message}${f.completedRefs === undefined ? '' : `; acknowledged Trash writes: ${f.completedRefs.join(', ')}`}`,
      ),
    )
  }
  for (const item of value.deleted) {
    lines.push(
      `Trashed: ${item.ref} (version ${item.version}); descendants: ${item.children.join(', ') || 'none'}`,
    )
  }
  const unverified = value.unverified
  if (unverified.length > 0) {
    lines.push(
      `Unverified creates (${unverified.length}; do not retry):`,
      ...unverified.map(
        (entry) =>
          `- index ${entry.index}${entry.ref === undefined ? '' : `: ${entry.ref}`}${entry.key === undefined ? '' : ` (key ${entry.key})`}: ${entry.reason}; reconcile in Zotero before further action`,
      ),
    )
  }
  if (value.libraryVersion !== undefined) {
    lines.push(
      libraryVersionLine({ libraryVersion: value.libraryVersion, serverId: value.serverId }),
    )
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function presentBatchItemsResult(
  _args: BatchItemsArgs,
  result: ToolResult,
): ToolResultView | undefined {
  return presentBatchItemsResultView(result)
}

export function registerBatchItemsTool(ctx: Context, service: ZoteroService): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'zotero_batch_items',
      description:
        'Create items, update tags and collections, or move items to trash in a single call. Operations are reviewed in one plan card before execution. ' +
        WRITE_PLAN_OUTCOME_DESCRIPTION +
        ' Entries in unverified must be treated as committed: do not retry; reconcile by key/ref or check Zotero first.',
      parameters: BATCH_ITEMS_PARAMETERS,
      output: {
        schema: BATCH_ITEMS_OUTPUT_SCHEMA,
        render: renderBatchItems,
        presentationMeta: (_args, value): JsonValue => {
          if (value.kind === 'declined') return { kind: 'declined' }
          return {
            kind: 'applied',
            createdCount: value.created.length,
            created: value.created,
            updatedCount: value.updated.length,
            deletedCount: value.deleted.length,
            failedCount: value.failed.length,
            unverified: value.unverified,
            unverifiedCount: value.unverified.length,
            ...(value.serverId === undefined ? {} : { serverId: value.serverId }),
            ...(value.libraryVersion === undefined ? {} : { libraryVersion: value.libraryVersion }),
          }
        },
      },
      presentCall: (args) => {
        const c = args.create?.length ?? 0
        const u = args.update?.length ?? 0
        const d = args.delete?.length ?? 0
        return {
          card: 'generic',
          kind: 'edit',
          title: 'Batch item operations',
          rawInput: `${c} creates, ${u} updates, ${d} deletes`,
        }
      },
      presentResult: presentBatchItemsResult,
      async execute(args, exec): Promise<ZoteroBatchItemsOutcome> {
        const request = buildBatchItemsRequest(args, service.config)
        const deletePreviews = await previewBatchItems(service, args.delete ?? [], exec.signal)
        return await service.batchItems(request, {
          exec,
          plan: batchItemsPlan(args, deletePreviews),
          ...(request.delete !== undefined && request.delete.length > 0
            ? { risk: 'recoverable-delete' as const }
            : {}),
        })
      },
    }),
  )
}
