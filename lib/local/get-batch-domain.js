/** Bounded, order-preserving batch metadata reads. */
import { formatRef } from '../refs.js';
import { mapWithConcurrency } from '../concurrency.js';
import { ZoteroError } from '../errors.js';
const MAX_BATCH = 50;
const CONCURRENCY = 8;
export const GET_BATCH_MAX = MAX_BATCH;
function errorOf(error) {
    if (error instanceof ZoteroError)
        return { code: error.code, message: error.message };
    if (error instanceof Error)
        return { code: 'ZOTERO_UNEXPECTED', message: error.message };
    return { code: 'ZOTERO_UNEXPECTED', message: String(error) };
}
function getRequestOf(ref, request) {
    const include = new Set();
    if (request.include?.children === true) {
        include.add('notes');
        include.add('annotations');
        include.add('attachments');
    }
    else if (request.include?.attachments === true) {
        include.add('attachments');
    }
    return {
        ref,
        include,
        ...(request.include?.bestAttachment === true ? { locations: 'best' } : {}),
        ...(request.fields !== undefined ? { fields: request.fields } : {}),
    };
}
/** Read up to 50 refs with at most eight child operations in flight. */
export async function getBatch(getItem, request, signal) {
    if (request.refs.length === 0)
        throw new ZoteroError('refs must list at least one Zotero ref', 'ZOTERO_INVALID_ARGUMENT');
    if (request.refs.length > MAX_BATCH) {
        throw new ZoteroError(`refs accepts at most ${MAX_BATCH} refs per call`, 'ZOTERO_INVALID_ARGUMENT');
    }
    const seen = new Set();
    for (const ref of request.refs) {
        const formatted = formatRef(ref);
        if (seen.has(formatted)) {
            throw new ZoteroError(`refs must be unique; duplicate ref: ${formatted}`, 'ZOTERO_INVALID_ARGUMENT');
        }
        seen.add(formatted);
    }
    const items = await mapWithConcurrency(request.refs, CONCURRENCY, async (ref, poolSignal) => {
        const refString = formatRef(ref);
        try {
            const detail = await getItem(getRequestOf(ref, request), poolSignal);
            const item = request.include?.relations === true
                ? detail
                : (() => {
                    const { relations: _relations, ...withoutRelations } = detail;
                    return withoutRelations;
                })();
            return { ref: refString, status: 'ok', item };
        }
        catch (error) {
            if (poolSignal.aborted)
                throw error;
            const detail = errorOf(error);
            return {
                ref: refString,
                status: 'error',
                code: detail.code,
                message: detail.message,
                ...(detail.code === 'ZOTERO_NOT_FOUND'
                    ? { next: 'Check the ref or search Zotero again before retrying.' }
                    : {}),
            };
        }
    }, { signal });
    const succeeded = items.filter((item) => item.status === 'ok').length;
    return {
        items,
        counts: { requested: items.length, succeeded, failed: items.length - succeeded },
    };
}
//# sourceMappingURL=get-batch-domain.js.map