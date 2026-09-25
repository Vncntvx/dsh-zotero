/**
 * The `/zotero status` human command: the control-plane check for Zotero
 * connectivity. Search/notes/tags/collections stay agent-tool territory —
 * slash commands are not a second Zotero CLI.
 * @module dsh-zotero/command
 */

import type { Context } from '@deepseek-ai/cordis'
// Value + type: pulls the `ctx.commands` Context merge into this program.
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import type { ZoteroService } from './service.js'
import type { ZoteroStatus } from './types.js'

/** The usage line an unknown `/zotero` subcommand is answered with. */
export const ZOTERO_USAGE_MESSAGE = 'Usage: /zotero status'

/** The status header when the local API answered the probe. */
export const ZOTERO_STATUS_CONNECTED = 'Zotero local API: connected'

/** The status header when Zotero could not be reached at all. */
export const ZOTERO_STATUS_DISCONNECTED = 'Zotero local API: not connected'

/** The value a status line reports when the answering build named none. */
export const ZOTERO_STATUS_NOT_REPORTED = 'not reported'

/**
 * The Server-ID line for a build that does not identify its database. Refs and
 * cursors pin to that identity, so its absence is a fact about what this
 * Zotero can support rather than a missing detail.
 */
export const ZOTERO_STATUS_SERVER_ID_UNREPORTED =
  'Server ID: not reported — this build does not identify its database, so refs and cursors cannot be pinned to it'

/** One `Label: value` status line, degraded to {@link ZOTERO_STATUS_NOT_REPORTED}. */
export function statusLine(label: string, value: string | undefined): string {
  return `${label}: ${value ?? ZOTERO_STATUS_NOT_REPORTED}`
}

/** Render a status record for the command's user-facing text. */
export function formatStatus(status: ZoteroStatus): string {
  if (!status.connected) {
    return `${ZOTERO_STATUS_DISCONNECTED}\n${status.diagnosis}`
  }
  return [
    ZOTERO_STATUS_CONNECTED,
    statusLine('Zotero version', status.zoteroVersion),
    statusLine('API version', status.apiVersion),
    statusLine('Schema version', status.schemaVersion),
    status.serverId === undefined
      ? ZOTERO_STATUS_SERVER_ID_UNREPORTED
      : statusLine('Server ID', status.serverId),
    status.write === undefined
      ? undefined
      : statusLine(
          'Write',
          !status.write.enabled
            ? 'disabled'
            : status.write.authorized
              ? 'enabled (key stored)'
              : 'enabled (no key yet)',
        ),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n')
}

/**
 * Register `/zotero status` when a command registry is composed. The
 * optional-dependency form keeps the plugin loadable in headless
 * compositions that have no `commands` service.
 */
export function registerStatusCommand(ctx: Context, service: ZoteroService): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: CommandDefinitionId('dsh-zotero/status'),
      name: 'zotero',
      description: 'Check the local Zotero connection status',
      input: { hint: 'status' },
      recordInput: false,
      handler: async (invocation) => {
        const arg = invocation.rawInput.trim()
        if (arg !== '' && arg !== 'status') {
          return { kind: 'error', text: ZOTERO_USAGE_MESSAGE }
        }
        const status = await service.status(invocation.signal)
        return { kind: 'success', text: formatStatus(status) }
      },
    })
  })
}
