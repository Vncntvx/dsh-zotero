/**
 * The `zotero_attachment` tool: resolve an attachment ref to a location the
 * Agent can act on — an on-disk file path (verified to exist) or the linked
 * URL. This is the escalation path for PDFs Zotero has not full-text-indexed.
 * @module dsh-zotero/tools/attachment
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ZoteroService } from '../service.js';
/**
 * The file arm states which filesystem its path belongs to. The plugin's
 * loopback pin means it and Zotero run on the same machine, so the path is
 * valid *there* — but the reader is a tool call, and a host may run file
 * access in another environment (a sandbox, a container, a remote worker).
 * Saying so costs one line and saves a turn spent on a path that was never
 * visible to that reader.
 */
export declare const FILE_ENVIRONMENT_MESSAGE = "File environment: the machine running Zotero (this plugin only reaches a loopback API, so that is this machine). A reader elsewhere \u2014 a sandbox, a container, a remote host \u2014 may not see this path.";
export declare function registerAttachmentTool(ctx: Context, service: ZoteroService): void;
//# sourceMappingURL=attachment.d.ts.map