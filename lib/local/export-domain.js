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
import { ITEM_WITHOUT_KEY_MESSAGE } from '../normalize-context.js';
import { locateExportItemsFromBatch } from '../export-mapping.js';
import { formatRef, libraryPrefix, sameLibrary, requireSupportedLocalRef, PERSONAL_LIBRARY, } from '../refs.js';
import { chunkItemKeyBatches, requireArrayBody } from './pagination.js';
/**
 * The `itemKey=` value for one batch: Zotero splits the comma-joined list
 * itself (`new Set(...split(','))`, `server_localAPI.js:1117-1129`), so this
 * one spelling is the whole wire contract. Every batched read builds it here.
 */
function itemKeyList(refs) {
    return refs.map((ref) => ref.key).join(',');
}
/**
 * The panel's export arm: the rendered text/citations for the requested
 * items and nothing else. Citation and bibliography answers are identical to
 * {@link exportItems}; the translator formats return the merged body without
 * locating individual documents inside it.
 */
export async function exportText(deps, request, signal, onProgress) {
    const { result } = await exportBody(deps, request, signal, onProgress, false);
    return result;
}
/**
 * Export the requested items through the Local API's format pipeline:
 * `include=citation` pairs each item with its HTML citation (batched to the
 * API's itemKey cap when the request is larger), `format=bib` yields a
 * joined CSL-sorted bibliography, and the translator formats
 * (`bibtex`/`biblatex`/`ris`/`csljson`) export the whole set at once. The
 * batch-breaking formats refuse to exceed `ZOTERO_ITEMKEY_BATCH`, because
 * their global ordering belongs to Zotero and splitting them would silently
 * reorder the output. The translator formats additionally itemize each
 * document by locating it directly within the batch body in memory, pairing
 * each ref with its citation key, span offsets, and display title where
 * possible, and falling back gracefully to a bare ref if an item is omitted
 * by the translator output. Output that exceeds `maxExportChars` fails with
 * OUTPUT_TOO_LARGE: export text is never mid-truncated.
 */
export async function exportItems(deps, request, signal, onProgress) {
    const { result, refs, rawItems } = await exportBody(deps, request, signal, onProgress, true);
    if (result.format === 'citation' || result.format === 'bibliography')
        return result;
    // The browser holds `text` with its leading whitespace trimmed (the
    // render strips it), so the entry offsets are measured on that same
    // trimmed body.
    const items = locateExportItemsFromBatch(result.format, result.text.trimStart(), [...refs], rawItems);
    return { ...result, items };
}
/**
 * The shared format pipeline behind both arms. `itemizeMetadata` decides
 * whether the bibtex-family raw-item read runs: the tool's itemization needs
 * it, while the panel's text arm must not pay for it.
 */
async function exportBody(deps, request, signal, onProgress, itemizeMetadata) {
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
    // Duplicate refs name the same item, and Zotero caps one itemKey request
    // at ZOTERO_ITEMKEY_BATCH keys anyway, so every unique key is requested
    // exactly once, keeping the first-seen order. Dedupe by canonical ref
    // (library+key), not bare key.
    const seen = new Set();
    const refs = [];
    for (const ref of request.refs) {
        const canonical = `${ref.library.type}:${ref.library.id}:${ref.key}`;
        if (seen.has(canonical))
            continue;
        seen.add(canonical);
        refs.push(ref);
    }
    if (refs.length > ZOTERO_ITEMKEY_BATCH) {
        throw new ZoteroError(`The ${request.format} format accepts at most ${ZOTERO_ITEMKEY_BATCH} item refs per call (Zotero's itemKey request cap, which also keeps the format's global ordering intact). Request up to ${ZOTERO_ITEMKEY_BATCH} refs at a time, or use citation, which batches up to the configured export cap.`, ZOTERO_INVALID_ARGUMENT);
    }
    onProgress?.({
        phase: 'fetch_batch',
        current: 0,
        total: refs.length,
        message: `Fetching ${refs.length} items (${request.format})...`,
    });
    const search = new URLSearchParams();
    search.set('itemKey', itemKeyList(refs));
    if (request.format === 'bibliography') {
        search.set('format', 'bib');
        search.set('style', style);
        search.set('locale', locale);
    }
    else {
        search.set('format', request.format);
    }
    const isBibtexFamily = request.format === 'bibtex' || request.format === 'biblatex';
    const exportPromise = deps.client.get(`${exportPrefix}/items`, search, { signal, serverId });
    const metaPromise = itemizeMetadata && isBibtexFamily
        ? fetchRawItemBatch(deps.client, exportPrefix, refs, signal, serverId)
        : Promise.resolve([]);
    const [{ body }, rawItems] = await Promise.all([exportPromise, metaPromise]);
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
        return { result: { format: 'bibliography', style, locale, text: body }, refs, rawItems: [] };
    }
    return { result: { format: request.format, text: body }, refs, rawItems };
}
async function fetchRawItemBatch(client, prefix, refs, signal, serverId) {
    const search = new URLSearchParams();
    search.set('itemKey', itemKeyList(refs));
    try {
        const { json } = await client.getJson(`${prefix}/items`, search, { signal, serverId });
        if (Array.isArray(json)) {
            return json
                .map(asRecord)
                .filter((item) => item !== undefined);
        }
    }
    catch (error) {
        // Fail-open for metadata: if raw JSON fetch fails, alignment still proceeds with
        // available fields and direct keys without failing the export. Cancellation is
        // not a metadata failure: swallowing it would report a body the caller stopped
        // as a settled success.
        if (signal?.aborted)
            throw error;
    }
    return [];
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
    search.set('itemKey', itemKeyList(batch));
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