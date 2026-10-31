/**
 * The `/zotero` human command (optional synonym `status`): the control-plane
 * check for Zotero connectivity. Search/notes/tags/collections stay
 * agent-tool territory, since slash commands are not a second Zotero CLI.
 *
 * The `input` descriptor is what admits the optional `status` argument: the
 * harness only routes a trailing word to a handler when the definition
 * declares input. `/zotero` and `/zotero status` therefore share one handler;
 * dropping `input` would silently demote `/zotero status` to a model prompt.
 *
 * `recordInput` stays at its default (`true`) so the durable `command/run`
 * keeps `args`, the raw input after the command name. The client's
 * command-input projection reads that field to echo the line the user typed;
 * `recordInput: false` would strip it and the bubble would collapse to a bare
 * `/zotero` even for `/zotero status`.
 * @module dsh-zotero/command
 */
// Value + type: pulls the `ctx.commands` Context merge into this program.
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands';
import { toStatusView } from './session-events.js';
/** The usage line an unknown `/zotero` subcommand is answered with. */
export const ZOTERO_USAGE_MESSAGE = 'Usage: /zotero [status]';
/*
 * The status text. These are **human-facing output only**: the model reads the
 * command's reply and a user reads the card, but no client parses them. The
 * structured facts travel as the `zotero/status` session event, so the wording
 * here is free to change without breaking a consumer.
 */
/** The value a status line reports when the answering build named none. */
const STATUS_NOT_REPORTED = 'not reported';
/** Status line field labels. */
const FIELD_VERSION = 'Zotero version';
const FIELD_API = 'API version';
const FIELD_SCHEMA = 'Schema version';
const FIELD_SERVER_ID = 'Server ID';
const FIELD_WRITE = 'Write';
/** The dialled authority, reported on both the connected and the failed probe. */
const FIELD_ENDPOINT = 'Local API';
/** The status header when the local API answered the probe. */
export const ZOTERO_STATUS_CONNECTED = 'Zotero local API: connected';
/** The status header when Zotero could not be reached at all. */
export const ZOTERO_STATUS_DISCONNECTED = 'Zotero local API: not connected';
/**
 * The Server-ID line for a build that does not identify its database. Refs and
 * cursors pin to that identity, so its absence limits what this Zotero can
 * support.
 */
export const ZOTERO_STATUS_SERVER_ID_UNREPORTED = 'Server ID: not reported — this build does not identify its database, so refs and cursors cannot be pinned to it';
/** Canonical status values for the Write field. */
const WRITE_DISABLED = 'disabled';
const WRITE_ENABLED_STORED = 'enabled (key stored)';
const WRITE_ENABLED_PENDING = 'enabled (no key yet)';
/** One `Label: value` status line, degraded to {@link STATUS_NOT_REPORTED}. */
export function statusLine(label, value) {
    return `${label}: ${value ?? STATUS_NOT_REPORTED}`;
}
/** Render a status record for the command's user-facing text. */
export function formatStatus(status) {
    // The dialled address leads both arms. When the probe answered it is the
    // endpoint the facts below came from; when it did not, it is the address
    // that failed to answer, the first thing worth checking either way.
    const endpoint = statusLine(FIELD_ENDPOINT, status.endpoint);
    if (!status.connected) {
        return `${ZOTERO_STATUS_DISCONNECTED}\n${endpoint}\n${status.diagnosis}`;
    }
    return [
        ZOTERO_STATUS_CONNECTED,
        endpoint,
        statusLine(FIELD_VERSION, status.zoteroVersion),
        statusLine(FIELD_API, status.apiVersion),
        statusLine(FIELD_SCHEMA, status.schemaVersion),
        status.serverId === undefined
            ? ZOTERO_STATUS_SERVER_ID_UNREPORTED
            : statusLine(FIELD_SERVER_ID, status.serverId),
        status.write === undefined
            ? undefined
            : statusLine(FIELD_WRITE, !status.write.enabled
                ? WRITE_DISABLED
                : status.write.authorized
                    ? WRITE_ENABLED_STORED
                    : WRITE_ENABLED_PENDING),
    ]
        .filter((line) => line !== undefined)
        .join('\n');
}
/**
 * Register `/zotero` when a command registry is composed. The
 * optional-dependency form keeps the plugin loadable in headless
 * compositions that have no `commands` service.
 */
export function registerStatusCommand(ctx, service) {
    ctx.inject(['commands'], (commandCtx) => {
        commandCtx.commands.register({
            definitionId: CommandDefinitionId('dsh-zotero/status'),
            name: 'zotero',
            description: 'Check the local Zotero connection status',
            // Required so `/zotero status` remains a command rather than a prompt;
            // the handler treats the word as an optional synonym for the bare form.
            // `recordInput` stays default-true: the command-input projection echoes
            // `command/run.args`, and `recordInput: false` would strip that field.
            input: { hint: 'status' },
            handler: async (invocation) => {
                const arg = invocation.rawInput.trim();
                if (arg !== '' && arg !== 'status') {
                    return { kind: 'error', text: ZOTERO_USAGE_MESSAGE };
                }
                const status = await service.status(invocation.signal);
                // The text stays the human answer; the structured facts travel as the
                // session event the card reads back through the `zoteroStatus`
                // projection. `sourceEventSeq` is the documented way for a command to
                // point at a domain projection, so the card never parses this text
                // (`docs/subsystems/commands.md`: "without parsing `text`").
                const event = invocation.agent.session.append('zotero/status', {
                    version: 1,
                    status: toStatusView(status),
                });
                return {
                    kind: 'success',
                    text: formatStatus(status),
                    sourceEventSeq: event.seq,
                };
            },
        });
    });
}
//# sourceMappingURL=command.js.map