/**
 * The `/zotero status` human command: the control-plane check for Zotero
 * connectivity. Search/notes/tags/collections stay agent-tool territory —
 * slash commands are not a second Zotero CLI.
 * @module dsh-zotero/command
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type { ZoteroService } from './service.js'
import type { ZoteroStatus } from './types.js'

/** Render a status record for the command's user-facing text. */
function formatStatus(status: ZoteroStatus): string {
  if (!status.connected) {
    return `Zotero local API: not connected\n${status.diagnosis}`
  }
  return [
    'Zotero local API: connected',
    `API version: ${status.apiVersion ?? 'not reported'}`,
    `Schema version: ${status.schemaVersion ?? 'not reported'}`,
    status.serverId === undefined
      ? 'Server ID: not reported (Zotero 9 or earlier)'
      : `Server ID: ${status.serverId}`,
  ].join('\n')
}

/**
 * Register `/zotero status` when a command registry is composed. The
 * optional-dependency form keeps the plugin loadable in headless
 * compositions that have no `commands` service.
 */
export function registerStatusCommand(ctx: Context, service: ZoteroService): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'zotero',
      description: 'Check the local Zotero connection status',
      input: { hint: 'status' },
      recordInput: false,
      handler: async (invocation) => {
        const arg = invocation.rawInput.trim()
        if (arg !== '' && arg !== 'status') {
          return { kind: 'error', text: 'Usage: /zotero status' }
        }
        const status = await service.status(invocation.signal)
        return { kind: 'success', text: formatStatus(status) }
      },
    })
  })
}
