/**
 * Session-authorized, revision-fenced pages over the core's complete source
 * ledger.
 *
 * The projection's wire view is windowed (a long session must not grow the
 * emission), so the browser reaches the rows behind that window through this
 * module: the fold is read at one synchronous Session cut, the requested list
 * is cut into a bounded page, and the continuation is the next offset bound to
 * that session, list, instance and the revision the page was read at.
 * @module dsh-zotero/source-page
 */
import { SessionId } from '@deepseek-ai/dsh-session';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS, ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES, } from './constants.js';
import { ZoteroError, invalid } from './errors.js';
import { requireZoteroService } from './service.js';
import { filterSources } from './sources/filters.js';
import { windowedItem } from './sources/window.js';
import { zoteroSourcePageRequestSchema } from './wire-schemas.js';
/**
 * Read one bounded page of the authorized session's complete literature trail.
 *
 * The page is cut from the full fold, never from the projection's windowed
 * view, so a filtered list or a long source is not truncated at the window.
 * Authorization is checked before the fold and again after it, and the
 * continuation is bound to the session, target, instance, revision and page
 * size, so a cursor cannot be replayed against another list or a moved
 * revision.
 * @param ctx - the host context.
 * @param input - the requested page.
 * @param signal - caller cancellation.
 * @returns the bounded page with its exact totals.
 */
export async function readSourcePage(ctx, input, signal) {
    signal.throwIfAborted();
    const parsed = zoteroSourcePageRequestSchema.safeParse(input);
    if (!parsed.success)
        invalid('Invalid literature-trail page request.');
    const request = parsed.data;
    const sessionId = SessionId(request.sessionId);
    const authorize = () => {
        if (ctx.get('remoteAccess')?.allows({ kind: 'session', id: sessionId }) === true)
            return;
        throw new RemoteError('remote-access/denied', 'Literature-trail access is not authorized for this session.', {
            action: 'zotero/sourcePage',
            reason: 'no-allow',
        });
    };
    authorize();
    const session = ctx.get('sessions')?.get(sessionId);
    if (session === undefined)
        throw new ZoteroError('The requested session is not open.', 'ZOTERO_NOT_FOUND');
    const { workspace: full, revision } = await requireZoteroService(ctx, signal).sourceWorkspace(session, signal, request.currentServerId);
    signal.throwIfAborted();
    authorize();
    if (ctx.get('sessions')?.get(sessionId) !== session) {
        throw new ZoteroError('The requested session is no longer open.', 'ZOTERO_NOT_FOUND');
    }
    if (request.revision !== undefined && request.revision !== revision) {
        throw new ZoteroError('The literature trail changed. Refresh before paging again.', 'ZOTERO_SOURCE_PAGE_STALE');
    }
    const cap = request.target.kind === 'sources'
        ? ZOTERO_SOURCE_WORKSPACE_MAX_SOURCES
        : ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS;
    const limit = Math.min(request.limit ?? cap, cap);
    const offset = request.offset ?? 0;
    const target = request.target;
    let sources = [];
    let exports = full.exports.slice(0, ZOTERO_SOURCE_WORKSPACE_MAX_ITEM_ROWS);
    let total;
    if (target.kind === 'sources') {
        const matching = filterSources(full.sources, target.filter);
        total = matching.length;
        sources = matching.slice(offset, offset + limit).map(windowedItem);
    }
    else if (target.kind === 'source') {
        const item = full.sources.find((source) => source.key === target.key);
        if (item === undefined)
            throw new ZoteroError('The requested source is not in this session.', 'ZOTERO_NOT_FOUND');
        const rows = target.rows;
        total = item[rows].length;
        sources = [{ ...windowedItem(item), [rows]: item[rows].slice(offset, offset + limit) }];
    }
    else {
        total = full.exports.length;
        exports = full.exports.slice(offset, offset + limit);
    }
    if (offset > 0 && offset >= total)
        invalid('The page offset is outside this list.');
    // The page owns the requested slice, not the whole fold: the browser
    // appends the workspace's rows to what it already shows, so a full list
    // here would repeat the head the projection view already served.
    return {
        sessionId,
        target,
        revision,
        offset,
        limit,
        total,
        workspace: { ...full, sources, exports },
    };
}
//# sourceMappingURL=source-page.js.map