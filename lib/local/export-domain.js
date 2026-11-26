/**
 * The export domain shared by the `zotero_export` tool and the library
 * panel's export endpoint: citations batched to the API's itemKey cap, the
 * CSL-sorted bibliography, and the translator formats whose per-document
 * entries the tool locates server-side against the merged batch body. The
 * panel's text arm stops at the rendered body; itemization is tool-only.
 * @module dsh-zotero/local/export-domain
 */
import { mapWithConcurrency } from '../concurrency.js';
import { ZOTERO_ITEMKEY_BATCH } from '../constants.js';
import { ZOTERO_INVALID_ARGUMENT, ZOTERO_NOT_FOUND, ZOTERO_OUTPUT_TOO_LARGE, ZOTERO_SERVER_MISMATCH, ZOTERO_UNEXPECTED, SERVER_MISMATCH_MESSAGE, ZoteroError, } from '../errors.js';
import { asRecord, asString, isObjectKey } from '../json.js';
import { citationKeyInfoOf } from '../citation-key.js';
import { ITEM_WITHOUT_KEY_MESSAGE } from '../normalize-context.js';
import { locateExportItemsFromBatch } from '../export-mapping.js';
import { formatRef, libraryPrefix, sameLibrary, requireSupportedLocalRef, PERSONAL_LIBRARY, } from '../refs.js';
import { itemKeyList } from './wire.js';
import { assertUniqueExportRefs } from '../export-limits.js';
import { chunkItemKeyBatches, requireArrayBody } from './pagination.js';
/**
 * The panel's export arm: the rendered text/citations for the requested
 * items and nothing else. Citation and bibliography answers are identical to
 * {@link exportItems}; the translator formats return the merged body without
 * locating individual documents inside it.
 */
export async function exportText(deps, request, signal, onProgress) {
    const { result } = await exportBody(deps, request, signal, onProgress);
    return result;
}
/**
 * Export the requested items through the Local API's format pipeline:
 * `include=citation` pairs each item with its HTML citation (batched to the
 * API's itemKey cap when the request is larger), `format=bib` yields a
 * joined CSL-sorted bibliography, and the remaining formats
 * (`bibtex`/`biblatex`/`ris`/`csv`) export the whole set at once. CSL JSON
 * is assembled from individual translator results keyed by their API rows.
 * The batch-breaking formats refuse to exceed `ZOTERO_ITEMKEY_BATCH`, because
 * their global ordering belongs to Zotero and splitting them would silently
 * reorder the output. Itemized formats also read one bounded raw-metadata
 * batch for citekeys and field alignment, then pair each ref with its export
 * key, citekey, span offsets, and display title where available. An item
 * omitted by the translator stays ref-only after its existence is verified; `csv` returns Zotero's whole-body table with
 * no per-document entries. Output that exceeds `maxExportChars` fails with
 * OUTPUT_TOO_LARGE: export text is never mid-truncated.
 */
export async function exportItems(deps, request, signal, onProgress) {
    const { result, refs, rawItems, cslItems } = await exportBody(deps, request, signal, onProgress);
    if (result.format === 'citation' || result.format === 'bibliography' || result.format === 'csv') {
        return result;
    }
    // Entry spans address the verbatim translator body, including leading whitespace.
    const items = cslItems ?? locateExportItemsFromBatch(result.format, result.text, refs, rawItems);
    return {
        ...result,
        items,
    };
}
/**
 * The shared pipeline verifies every requested key independently of translator output.
 * Both tool and panel arms use the same existence check.
 */
async function exportBody(deps, request, signal, onProgress) {
    for (const ref of request.refs)
        requireSupportedLocalRef(ref, ['item']);
    // Export is single-library (v3 lock): all refs must share the same SupportedLocalLibrary
    const firstLibrary = request.refs[0]?.library;
    if (firstLibrary !== undefined) {
        for (const ref of request.refs.slice(1)) {
            if (!sameLibrary(firstLibrary, ref.library)) {
                throw new ZoteroError('All refs in one export must belong to the same library (personal or a single group). Split by library.', ZOTERO_INVALID_ARGUMENT);
            }
        }
    }
    // Every ref must come from the same Zotero instance: the request header
    // carries one identity, and a ref from another instance must fail closed
    // instead of silently resolving same-key objects there.
    const serverIds = new Set(request.refs.map((ref) => ref.serverId).filter((id) => id !== undefined));
    if (serverIds.size > 1)
        throw new ZoteroError(SERVER_MISMATCH_MESSAGE, ZOTERO_SERVER_MISMATCH);
    assertUniqueExportRefs(request.refs, (message) => {
        throw new ZoteroError(message, ZOTERO_INVALID_ARGUMENT);
    });
    const serverId = serverIds.size === 1 ? serverIds.values().next().value : undefined;
    const exportLibrary = (firstLibrary ??
        PERSONAL_LIBRARY);
    const exportPrefix = libraryPrefix(exportLibrary);
    const style = request.style ?? deps.limits.defaultStyle;
    const locale = request.locale ?? deps.limits.defaultLocale;
    if (request.format === 'citation') {
        return {
            result: await exportCitations(deps, {
                refs: request.refs,
                prefix: exportPrefix,
                serverId,
                style,
                locale,
                signal,
                onProgress,
            }),
            refs: [],
            rawItems: [],
        };
    }
    const refs = request.refs;
    if (refs.length > ZOTERO_ITEMKEY_BATCH) {
        throw new ZoteroError(`The ${request.format} format accepts at most ${ZOTERO_ITEMKEY_BATCH} item refs per call (Zotero's itemKey request cap, which also keeps the format's global ordering intact). Request up to ${ZOTERO_ITEMKEY_BATCH} refs at a time, or use citation, which batches up to the configured export cap.`, ZOTERO_INVALID_ARGUMENT);
    }
    onProgress?.({
        phase: 'fetch_batch',
        current: 0,
        total: refs.length,
        message: `Fetching ${refs.length} items (${request.format})...`,
    });
    const verification = new URLSearchParams({ itemKey: itemKeyList(refs.map((ref) => ref.key)) });
    if (request.format === 'csljson')
        verification.set('include', 'data,csljson');
    const search = new URLSearchParams(verification);
    if (request.format === 'bibliography') {
        search.set('format', 'bib');
        search.set('style', style);
        search.set('locale', locale);
    }
    else {
        search.set('format', request.format);
    }
    const translation = request.format === 'csljson'
        ? undefined
        : deps.client.get(`${exportPrefix}/items`, search, { signal, serverId });
    const verificationBatch = fetchRawItemBatch(deps.client, exportPrefix, verification, refs, signal, serverId);
    let body;
    let rawItems = [];
    let cslItems;
    if (translation === undefined) {
        const csl = assembleCslJson(await verificationBatch, refs);
        body = csl.text;
        cslItems = csl.items;
    }
    else {
        const [translated, verified] = await Promise.all([translation, verificationBatch]);
        body = translated.body;
        rawItems = [...verified.values()];
    }
    // Close the progress event the fetch opened: without this the receipt
    // would sit at "Fetching N items…" forever, since the batched read has no
    // per-item steps to report.
    onProgress?.({
        phase: 'fetch_batch',
        current: refs.length,
        total: refs.length,
        message: `Fetched ${refs.length} items (${request.format}).`,
    });
    if (body.length > deps.limits.maxExportChars) {
        throw new ZoteroError(`Export output of ${body.length} characters exceeds the ${deps.limits.maxExportChars}-character export limit.`, ZOTERO_OUTPUT_TOO_LARGE);
    }
    if (request.format === 'bibliography') {
        return {
            result: { format: 'bibliography', style, locale, text: body },
            refs,
            rawItems: [],
        };
    }
    return {
        result: { format: request.format, text: body },
        refs,
        rawItems,
        cslItems,
    };
}
/**
 * Verify the requested item set before delivering any non-citation export.
 * Zotero's itemKey scope expands requested parents to include descendants.
 * Keep each requested key exactly once, in the order the API returned it.
 */
async function fetchRawItemBatch(client, prefix, search, refs, signal, serverId) {
    const { json } = await client.getJson(`${prefix}/items`, search, { signal, serverId });
    const expected = new Set(refs.map((ref) => ref.key));
    const matched = new Map();
    for (const row of requireArrayBody(json, 'export item verification')) {
        const record = asRecord(row);
        const key = asString(record?.key);
        if (record === undefined || key === undefined || !isObjectKey(key))
            throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED);
        if (!expected.has(key))
            continue;
        if (matched.has(key))
            throw new ZoteroError('Zotero returned a duplicate export item.', ZOTERO_UNEXPECTED);
        matched.set(key, record);
    }
    const missing = refs.filter((ref) => !matched.has(ref.key));
    if (missing.length > 0)
        throw new ZoteroError(`Zotero did not return requested items: ${missing.map(formatRef).join(', ')}.`, ZOTERO_NOT_FOUND);
    return matched;
}
/** The per-row include is a JSON string containing zero or one CSL record. */
function cslEntryOf(row) {
    const message = 'Zotero returned an invalid per-item CSL JSON export.';
    const body = asString(row.csljson);
    if (body === undefined)
        throw new ZoteroError(message, ZOTERO_UNEXPECTED);
    let decoded;
    try {
        decoded = JSON.parse(body);
    }
    catch (cause) {
        throw new ZoteroError(message, ZOTERO_UNEXPECTED, { cause });
    }
    if (Array.isArray(decoded) && decoded.length === 0)
        return undefined;
    const entry = Array.isArray(decoded) && decoded.length === 1 ? asRecord(decoded[0]) : undefined;
    if (entry === undefined)
        throw new ZoteroError(message, ZOTERO_UNEXPECTED);
    return entry;
}
function assembleCslJson(verified, refs) {
    const entries = [];
    const details = new Map();
    for (const [key, row] of verified) {
        const entry = cslEntryOf(row);
        const citation = citationKeyInfoOf(asRecord(row.data) ?? row);
        if (entry === undefined) {
            details.set(key, citation);
            continue;
        }
        const exportKey = asString(entry.id);
        const title = asString(entry.title);
        details.set(key, {
            ...citation,
            entryIndex: entries.length,
            ...(exportKey === undefined ? {} : { exportKey }),
            ...(title === undefined ? {} : { title }),
        });
        entries.push(entry);
    }
    return {
        text: JSON.stringify(entries, null, '\t'),
        items: refs.map((ref) => ({ ref: formatRef(ref), ...details.get(ref.key) })),
    };
}
/**
 * Citation export: batches the refs into API-sized requests, merges the
 * per-key citations, and reorders them to the requested sequence. Order is
 * exact (each citation stays paired with its ref), so batching is
 * invisible to the caller.
 */
async function exportCitations(deps, options) {
    const batches = chunkItemKeyBatches(options.refs);
    let completedItems = 0;
    const citationByKey = new Map();
    const concurrency = deps.limits.graphConcurrency;
    const batchResults = await mapWithConcurrency(batches, concurrency, async (batch, poolSignal) => {
        const result = await fetchCitationBatch(deps, batch, options.prefix, options.serverId, options.style, options.locale, poolSignal ?? options.signal);
        completedItems += batch.length;
        options.onProgress?.({
            phase: 'citation_batch',
            current: Math.min(completedItems, options.refs.length),
            total: options.refs.length,
            message: `Exporting citations ${Math.min(completedItems, options.refs.length)}/${options.refs.length}...`,
        });
        return result;
    }, { signal: options.signal });
    for (const batchMap of batchResults) {
        for (const [key, text] of batchMap) {
            citationByKey.set(key, text);
        }
    }
    options.onProgress?.({
        phase: 'citation_batch',
        current: options.refs.length,
        total: options.refs.length,
        message: `Exported ${options.refs.length}/${options.refs.length} citations`,
    });
    const citations = options.refs.map((ref) => {
        const text = citationByKey.get(ref.key);
        if (text === undefined) {
            throw new ZoteroError(`Zotero did not return an item for ${formatRef(ref)}.`, ZOTERO_NOT_FOUND);
        }
        return { ref: formatRef(ref), text };
    });
    const totalChars = citations.reduce((sum, entry) => sum + entry.text.length, 0);
    if (totalChars > deps.limits.maxExportChars) {
        throw new ZoteroError(`Citation output of ${totalChars} characters exceeds the ${deps.limits.maxExportChars}-character export limit.`, ZOTERO_OUTPUT_TOO_LARGE);
    }
    return { format: 'citation', style: options.style, locale: options.locale, citations };
}
/** One batch of per-key citations, at most `ZOTERO_ITEMKEY_BATCH` keys. */
async function fetchCitationBatch(deps, batch, prefix, serverId, style, locale, signal) {
    const search = new URLSearchParams();
    search.set('itemKey', itemKeyList(batch.map((ref) => ref.key)));
    search.set('include', 'citation');
    search.set('style', style);
    search.set('locale', locale);
    const { json } = await deps.client.getJson(`${prefix}/items`, search, {
        signal,
        serverId,
    });
    const citationByKey = new Map();
    for (const row of requireArrayBody(json, 'citation batch')) {
        const record = asRecord(row);
        const key = asString(record?.key);
        if (key === undefined || !isObjectKey(key)) {
            throw new ZoteroError(ITEM_WITHOUT_KEY_MESSAGE, ZOTERO_UNEXPECTED);
        }
        citationByKey.set(key, asString(record?.citation) ?? '');
    }
    return citationByKey;
}
//# sourceMappingURL=export-domain.js.map