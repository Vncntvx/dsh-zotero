/** Human panel mutations enter the registered tool pipeline and its service approval seam. */
import type { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { randomUUID } from 'node:crypto'
import type { ZoteroLibraryWriteRequestView, ZoteroLibraryWriteResultView } from './contract.js'
import { requireZoteroService } from './service.js'
import { ZOTERO_WRITE_TOOL_NAMES } from './constants.js'
import { classifyDenial } from './library-write-denial.js'
import {
  ZoteroError,
  ZOTERO_CAPABILITY_UNAVAILABLE,
  ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
  WRITE_APPROVAL_UNAVAILABLE_MESSAGE,
  ZOTERO_UNEXPECTED,
} from './errors.js'
import { zoteroLibraryWriteRequestSchema } from './wire-schemas.js'
import { asRecord, asString } from './json.js'

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
  return await executeZoteroSessionWrite(
    ctx,
    request.sessionId,
    'zotero/write',
    TOOLS[request.operation],
    request.operation === 'trash' ? { delete: request.args.refs } : request.args,
    signal,
  )
}

export async function requireZoteroWriteSession(
  ctx: Context,
  session: string,
  action:
    | 'zotero/write'
    | 'zotero/readerUpdateAnnotation'
    | 'zotero/readerCreateAnnotations'
    | 'zotero/readerDeleteAnnotation'
    | 'zotero/readerWriteNote',
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const service = requireZoteroService(ctx, signal)
  if (service.config.writeEnabled !== true)
    throw new ZoteroError('Zotero writes are disabled.', ZOTERO_CAPABILITY_UNAVAILABLE)
  const sessionId = SessionId(session)
  const requireAccess = () => {
    if (!ctx.get('remoteAccess')?.allows({ kind: 'session', id: sessionId })) {
      throw new RemoteError(
        'remote-access/denied',
        'Zotero writes are not authorized for this session.',
        { action, reason: 'no-allow' },
      )
    }
  }
  requireAccess()
  const sessions = ctx.get('sessionController')
  const resolved = await sessions?.resolveAgent(sessionId)
  signal.throwIfAborted()
  requireAccess()
  if (resolved === undefined || 'error' in resolved) {
    throw new ZoteroError(WRITE_APPROVAL_UNAVAILABLE_MESSAGE, ZOTERO_WRITE_APPROVAL_UNAVAILABLE)
  }
  if (resolved.agent.status === 'idle') {
    throw new ZoteroError(
      'Zotero write approval requires an active conversation turn. You can make this change in Zotero.',
      ZOTERO_WRITE_APPROVAL_UNAVAILABLE,
    )
  }
  return { service, agent: resolved.agent }
}

export async function executeZoteroSessionWrite(
  ctx: Context,
  session: string,
  action: 'zotero/write' | 'zotero/readerUpdateAnnotation',
  name: (typeof ZOTERO_WRITE_TOOL_NAMES)[number],
  args: object,
  signal: AbortSignal,
): Promise<ZoteroLibraryWriteResultView> {
  const { agent } = await requireZoteroWriteSession(ctx, session, action, signal)
  const tools = ctx.get('tools')
  if (tools?.get(name, agent) === undefined) {
    throw new ZoteroError(
      'The requested Zotero write tool is unavailable in this session.',
      ZOTERO_CAPABILITY_UNAVAILABLE,
    )
  }
  // No retry: even an interrupted or unverified result may already have committed.
  const batch = await tools.execute({
    agent,
    signal,
    calls: [
      {
        type: 'tool-call',
        id: ToolCallId(`zotero-panel-${randomUUID()}`),
        name,
        arguments: JSON.stringify(args),
      },
    ],
  })
  const callResult = batch.results[0]
  if (callResult === undefined) {
    throw new ZoteroError(
      'The requested Zotero write tool produced no execution result.',
      ZOTERO_UNEXPECTED,
    )
  }
  const result = callResult.result
  const kind = asString(asRecord(result.meta)?.kind) as
    ZoteroLibraryWriteResultView['kind'] | undefined
  const code = result.isError ? result.error.info?.code : undefined
  const declined = result.isError && classifyDenial(result) === 'declined'
  return {
    kind: declined
      ? 'declined'
      : result.isError
        ? 'failed'
        : kind === 'declined' ||
            kind === 'restored' ||
            kind === 'partial' ||
            kind === 'failed' ||
            kind === 'committed-unverified'
          ? kind
          : 'applied',
    message: result.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
    ...(typeof code === 'string' ? { code } : {}),
  }
}
