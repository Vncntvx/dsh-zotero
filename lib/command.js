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
import { ZOTERO_STATUS_CONNECTED, ZOTERO_STATUS_DISCONNECTED, ZOTERO_STATUS_NOT_REPORTED, ZOTERO_STATUS_SERVER_ID_UNREPORTED, ZOTERO_STATUS_FIELD_VERSION, ZOTERO_STATUS_FIELD_API, ZOTERO_STATUS_FIELD_SCHEMA, ZOTERO_STATUS_FIELD_SERVER_ID, ZOTERO_STATUS_FIELD_WRITE, ZOTERO_STATUS_FIELD_ENDPOINT, ZOTERO_STATUS_WRITE_DISABLED, ZOTERO_STATUS_WRITE_ENABLED_STORED, ZOTERO_STATUS_WRITE_ENABLED_PENDING, } from './contract.js';
/** The usage line an unknown `/zotero` subcommand is answered with. */
export const ZOTERO_USAGE_MESSAGE = 'Usage: /zotero [status]';
/** One `Label: value` status line, degraded to {@link ZOTERO_STATUS_NOT_REPORTED}. */
export function statusLine(label, value) {
    return `${label}: ${value ?? ZOTERO_STATUS_NOT_REPORTED}`;
}
/** Render a status record for the command's user-facing text. */
export function formatStatus(status) {
    // The dialled address leads both arms. When the probe answered it is the
    // endpoint the facts below came from; when it did not, it is the address
    // that failed to answer, the first thing worth checking either way.
    const endpoint = statusLine(ZOTERO_STATUS_FIELD_ENDPOINT, status.endpoint);
    if (!status.connected) {
        return `${ZOTERO_STATUS_DISCONNECTED}\n${endpoint}\n${status.diagnosis}`;
    }
    return [
        ZOTERO_STATUS_CONNECTED,
        endpoint,
        statusLine(ZOTERO_STATUS_FIELD_VERSION, status.zoteroVersion),
        statusLine(ZOTERO_STATUS_FIELD_API, status.apiVersion),
        statusLine(ZOTERO_STATUS_FIELD_SCHEMA, status.schemaVersion),
        status.serverId === undefined
            ? ZOTERO_STATUS_SERVER_ID_UNREPORTED
            : statusLine(ZOTERO_STATUS_FIELD_SERVER_ID, status.serverId),
        status.write === undefined
            ? undefined
            : statusLine(ZOTERO_STATUS_FIELD_WRITE, !status.write.enabled
                ? ZOTERO_STATUS_WRITE_DISABLED
                : status.write.authorized
                    ? ZOTERO_STATUS_WRITE_ENABLED_STORED
                    : ZOTERO_STATUS_WRITE_ENABLED_PENDING),
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
                return { kind: 'success', text: formatStatus(status) };
            },
        });
    });
}
//# sourceMappingURL=command.js.map