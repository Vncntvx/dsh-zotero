/**
 * The `/zotero` human command (optional synonym `status`): the control-plane
 * check for Zotero connectivity. Search/notes/tags/collections stay
 * agent-tool territory — slash commands are not a second Zotero CLI.
 *
 * The `input` descriptor is what admits the optional `status` argument: the
 * harness only routes a trailing word to a handler when the definition
 * declares input. `/zotero` and `/zotero status` therefore share one handler;
 * dropping `input` would silently demote `/zotero status` to a model prompt.
 *
 * `recordInput` stays at its default (`true`) so the durable `command/run`
 * keeps `args` — the raw input after the command name. The client's
 * command-input projection reads that field to echo the line the user typed;
 * `recordInput: false` would strip it and the bubble would collapse to a bare
 * `/zotero` even for `/zotero status`.
 * @module dsh-zotero/command
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from './service.js';
import type { ZoteroStatus } from './types.js';
/** The usage line an unknown `/zotero` subcommand is answered with. */
export declare const ZOTERO_USAGE_MESSAGE = "Usage: /zotero [status]";
/** One `Label: value` status line, degraded to {@link ZOTERO_STATUS_NOT_REPORTED}. */
export declare function statusLine(label: string, value: string | undefined): string;
/** Render a status record for the command's user-facing text. */
export declare function formatStatus(status: ZoteroStatus): string;
/**
 * Register `/zotero` when a command registry is composed. The
 * optional-dependency form keeps the plugin loadable in headless
 * compositions that have no `commands` service.
 */
export declare function registerStatusCommand(ctx: Context, service: ZoteroService): void;
//# sourceMappingURL=command.d.ts.map