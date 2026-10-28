/** Human panel mutations enter the registered tool pipeline and its service approval seam. */
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { randomUUID } from 'node:crypto'
import type { ZoteroLibraryWriteRequestView, ZoteroLibraryWriteResultView } from './contract.js'
import { requireZoteroService } from './service.js'
import { ZOTERO_WRITE_TOOL_NAMES } from './constants.js'
import {
  ZoteroError,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
} from './errors.js'
import { zoteroLibraryWriteRequestSchema } from './wire-schemas.js'

/**
 * Panel operation → registered write tool. The values are pinned to the one
 * write-tool name list (`ZOTERO_WRITE_TOOL_NAMES`), so a rename upstream
 * fails here at compile time.
 */
const TOOLS = {
  updateItem: 'zotero_update_item',
  updateTags: 'zotero_update_item_tags',
  updateMembership: 'zotero_update_item_collections',
  createItem: 'zotero_create_item',
  createNote: 'zotero_create_note',
  updateNote: 'zotero_update_note',
  createCollection: 'zotero_create_collection',
  updateCollection: 'zotero_update_collection',
  deleteCollection: 'zotero_delete_collection',
  createSavedSearch: 'zotero_create_saved_search',
  updateSavedSearch: 'zotero_update_saved_search',
  deleteSavedSearch: 'zotero_delete_saved_search',
  trash: 'zotero_batch_items',
  restore: 'zotero_restore_items',
  batch: 'zotero_batch_items',
} as const satisfies Record<
  ZoteroLibraryWriteRequestView['operation'],
  (typeof ZOTERO_WRITE_TOOL_NAMES)[number]
>

export async function executeLibraryWrite(
  ctx: Context,
  input: ZoteroLibraryWriteRequestView,
  signal: AbortSignal,
): Promise<ZoteroLibraryWriteResultView> {
  signal.throwIfAborted()
  const request = zoteroLibraryWriteRequestSchema.parse(input)
  const service = requireZoteroService(ctx, signal)
  if (service.config.writeEnabled !== true)
    throw new ZoteroError('Zotero writes are disabled.', ZOTERO_CAPABILITY_UNAVAILABLE)
  const sessionId = SessionId(request.sessionId)
  if (!ctx.get('remoteAccess')?.allows({ kind: 'session', id: sessionId })) {
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE)
  }
  const sessions = ctx.get('sessionController')
  const resolved = await sessions?.resolveAgent(sessionId)
  if (resolved === undefined || 'error' in resolved || resolved.agent.status !== 'running') {
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE)
  }
  const name = TOOLS[request.operation]
  const tools = ctx.get('tools')
  if (tools?.get(name, resolved.agent) === undefined) {
    throw new ZoteroError(
      'The requested Zotero write tool is unavailable in this session.',
      ZOTERO_CAPABILITY_UNAVAILABLE,
    )
  }
  // No retry: even an interrupted or unverified result may already have committed.
  const result = await tools.execute({
    agent: resolved.agent,
    signal,
    callId: ToolCallId(`zotero-panel-${randomUUID()}`),
    name,
    arguments: request.operation === 'trash' ? { delete: request.args.refs } : request.args,
  })
  const meta = result.meta
  const kind =
    meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta.kind : undefined
  const code = result.error?.info?.code
  const declined = result.isError && result.error?.message.includes('user rejected tool')
  return {
    kind: declined
      ? 'declined'
      : result.isError
        ? 'failed'
        : kind === 'declined' || kind === 'committed-unverified'
          ? kind
          : 'applied',
    message: result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
    ...(typeof code === 'string' ? { code } : {}),
  }
}
