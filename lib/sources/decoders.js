import { parseRefIdentity } from './source-capabilities.js';
/**
 * The meta decoding layer of the session source model for the search, get,
 * get-batch, match-references, children, retrieve, attachment, and browse
 * projections: each tool's presentation projection read off a settled block.
 * Export projections use this directory's `export-decoder.ts`. Tool-card
 * write and sync decoders live in `src/client/sources/`; writes never enter
 * the trail. The shapes
 * are the current wire shapes (session logs are per-session snapshots, so no
 * legacy projection versions are carried); reads are defensive, so an absent
 * or malformed field degrades to nothing instead of crashing the panel. Only
 * the fields the panel renders are decoded.
 * @module dsh-zotero/sources/decoders
 */
import { artifactOf, evidenceItemsOf } from './presenters.js';
import { boolField, isNonNegativeSafeInteger, isRecord, numberField, stringField } from '../json.js';
import { browseRowOf, isBrowseKind } from '../browse-rows.js';
/**
 * Whether the host's 8 KiB meta budget dropped this projection's detail keys:
 * the summary facts stay (counts, totals) and `detailOmitted` stamps the cut,
 * so a card can say "details were omitted" instead of showing fewer rows with
 * no reason. See `presentation-meta.ts` (`boundedPresentationMeta`).
 */
export function detailOmittedOf(meta) {
    return boolField(meta, 'detailOmitted') === true;
}
/**
 * One `{total, returned}` pair, or null when the projection carried neither.
 * A record that states a total but not a `returned` reads as everything came
 * back: that is the only reading a partial record supports, and a section
 * dropped over a missing count would hide a fact the projection did state.
 */
function childCountOf(value) {
    if (!isRecord(value))
        return null;
    const total = numberField(value, 'total');
    if (total === undefined)
        return null;
    return {
        total,
        returned: numberField(value, 'returned') ?? total,
        ...(value['completeness'] === 'complete' || value['completeness'] === 'page'
            ? { completeness: value['completeness'] }
            : {}),
        ...Object.fromEntries(['offset', 'limit', 'nextOffset'].flatMap((key) => {
            const number = numberField(value, key);
            return number === undefined ? [] : [[key, number]];
        })),
    };
}
/**
 * The bounded child previews the projection kept. A row without its ref or
 * preview text is dropped rather than rendered half: the panel reads the
 * complete data from the canonical result, and a card row that names nothing
 * is noise.
 */
function childPreviewsOf(value) {
    if (!Array.isArray(value))
        return [];
    const rows = [];
    for (const entry of value) {
        if (!isRecord(entry))
            continue;
        const ref = stringField(entry, 'ref');
        const preview = stringField(entry, 'preview');
        if (ref === undefined || preview === undefined)
            continue;
        const pageLabel = stringField(entry, 'pageLabel');
        const parentRef = stringField(entry, 'parentRef');
        rows.push({
            ref,
            preview,
            pageLabel: pageLabel ?? null,
            parentRef: parentRef ?? null,
        });
    }
    return rows;
}
/** Decode the compact fulltext-window fact a fulltext-mode retrieve projects. */
function fulltextReadOf(value) {
    if (!isRecord(value))
        return null;
    const sourceKind = value['sourceKind'];
    const textFormat = value['textFormat'];
    if (sourceKind !== 'attachment' && sourceKind !== 'url')
        return null;
    if (textFormat !== 'markdown' && textFormat !== 'text')
        return null;
    const sourceLabel = stringField(value, 'sourceLabel');
    const totalChars = countField(value, 'totalChars');
    const start = countField(value, 'start');
    const end = countField(value, 'end');
    const inputTruncated = boolField(value, 'inputTruncated');
    const isTruncated = boolField(value, 'isTruncated');
    // Older facts predate this field; default them to false.
    const spillAvailable = boolField(value, 'spillAvailable') ?? false;
    if (sourceLabel === undefined ||
        totalChars === undefined ||
        start === undefined ||
        end === undefined ||
        inputTruncated === undefined ||
        isTruncated === undefined)
        return null;
    const rawItem = value.item;
    let item;
    if (rawItem !== undefined) {
        if (!isRecord(rawItem))
            return null;
        const ref = stringField(rawItem, 'ref'), title = stringField(rawItem, 'title'), creatorSummary = stringField(rawItem, 'creatorSummary');
        if (!ref ||
            parseRefIdentity(ref)?.kind !== 'item' ||
            title === undefined ||
            creatorSummary === undefined)
            return null;
        const year = numberField(rawItem, 'year'), venue = stringField(rawItem, 'venue');
        item = {
            ref,
            title,
            creatorSummary,
            ...(year === undefined ? {} : { year }),
            ...(venue === undefined ? {} : { venue }),
        };
    }
    const attachmentContentType = stringField(value, 'attachmentContentType');
    const artifact = artifactOf(value['artifact']);
    const coverage = decodeCoverage(value['coverage']);
    const attachmentRef = stringField(value, 'attachmentRef');
    return {
        sourceKind,
        ...(item === undefined ? {} : { item }),
        ...(attachmentContentType === undefined ? {} : { attachmentContentType }),
        sourceLabel,
        textFormat,
        ...(artifact === undefined ? {} : { artifact }),
        ...(coverage === null ? {} : { coverage }),
        totalChars,
        inputTruncated,
        start,
        end,
        isTruncated,
        spillAvailable,
        ...(attachmentRef === undefined ? {} : { attachmentRef }),
    };
}
/** A character-count fact: integer, non-negative, and safe. */
function countField(record, key) {
    const value = record[key];
    return isNonNegativeSafeInteger(value) ? value : undefined;
}
export function browseMetaOf(meta) {
    const kind = stringField(meta, 'kind');
    const items = meta['items'];
    const rows = Array.isArray(items) ? items.map((item) => browseRowOf(item)) : null;
    const nextOffset = numberField(meta, 'nextOffset');
    return {
        kind: isBrowseKind(kind) ? kind : null,
        returned: numberField(meta, 'returned') ?? null,
        total: numberField(meta, 'total') ?? null,
        nextOffset: nextOffset ?? null,
        rows,
        omitted: Math.max(0, (numberField(meta, 'returned') ?? rows?.length ?? 0) - (rows?.length ?? 0)),
        detailOmitted: detailOmittedOf(meta),
    };
}
function decodeSearchRows(value) {
    if (!Array.isArray(value))
        return null;
    const rows = [];
    for (const item of value) {
        if (!isRecord(item))
            return null;
        const ref = stringField(item, 'ref');
        const title = stringField(item, 'title');
        const creatorSummary = stringField(item, 'creatorSummary');
        if (ref === undefined || title === undefined || creatorSummary === undefined)
            return null;
        const year = numberField(item, 'year');
        const itemType = stringField(item, 'itemType');
        const citationKey = stringField(item, 'citationKey');
        const citationKeySourceValue = stringField(item, 'citationKeySource');
        const citationKeySource = citationKeySourceValue === 'native' || citationKeySourceValue === 'extra'
            ? citationKeySourceValue
            : undefined;
        const conflict = isRecord(item['citationKeyConflict']) ? item['citationKeyConflict'] : null;
        const citationKeyConflict = conflict === null
            ? undefined
            : {
                native: stringField(conflict, 'native'),
                extra: stringField(conflict, 'extra'),
            };
        const bestAttachmentRef = stringField(item, 'bestAttachmentRef');
        const bestAttachmentType = stringField(item, 'bestAttachmentType');
        rows.push({
            ref,
            title,
            creatorSummary,
            ...(year === undefined ? {} : { year }),
            ...(itemType === undefined ? {} : { itemType }),
            ...(citationKey === undefined ? {} : { citationKey }),
            ...(citationKeySource === undefined ? {} : { citationKeySource }),
            ...(citationKeyConflict?.native === undefined || citationKeyConflict.extra === undefined
                ? {}
                : {
                    citationKeyConflict: {
                        native: citationKeyConflict.native,
                        extra: citationKeyConflict.extra,
                    },
                }),
            ...(bestAttachmentRef === undefined ? {} : { bestAttachmentRef }),
            ...(bestAttachmentType === undefined ? {} : { bestAttachmentType }),
        });
    }
    return rows;
}
function decodeSupportedLibrary(value) {
    if (!isRecord(value))
        return null;
    const type = stringField(value, 'type');
    const id = numberField(value, 'id');
    if (type === 'user' && id === 0)
        return { type: 'user', id: 0 };
    // isSafeInteger: an over-long group id loses precision in transit, so an
    // unsafe integer never names its digits.
    if (type === 'group' && id !== undefined && Number.isSafeInteger(id) && id > 0) {
        return { type: 'group', id };
    }
    return null;
}
function decodeResolvedScope(value) {
    if (!isRecord(value))
        return null;
    const kind = stringField(value, 'kind');
    if (kind === 'library') {
        const lib = decodeSupportedLibrary(value['library']);
        if (lib === null)
            return null;
        return { kind: 'library', library: lib };
    }
    if (kind === 'publications') {
        const lib = decodeSupportedLibrary(value['library']);
        if (lib === null || lib.type !== 'user')
            return null;
        return { kind: 'publications', library: lib };
    }
    if (kind === 'collection' || kind === 'savedSearch') {
        const ref = stringField(value, 'ref');
        const name = stringField(value, 'name');
        if (ref === undefined || name === undefined)
            return null;
        return kind === 'collection'
            ? { kind: 'collection', ref, name }
            : { kind: 'savedSearch', ref, name };
    }
    return null;
}
export function searchMetaOf(meta) {
    return {
        rows: decodeSearchRows(meta['items']),
        returned: numberField(meta, 'returned') ?? null,
        total: numberField(meta, 'total') ?? null,
        omitted: numberField(meta, 'omitted') ?? null,
        noteMatches: numberField(meta, 'noteMatches') ?? null,
        scope: decodeResolvedScope(meta['scope']),
        library: decodeSupportedLibrary(meta['library']),
        detailOmitted: detailOmittedOf(meta),
    };
}
export function getMetaOf(meta) {
    const resolved = isRecord(meta['resolvedAttachment']) ? meta['resolvedAttachment'] : null;
    const location = resolved && isRecord(resolved['location']) ? resolved['location'] : null;
    const resolvedAttachment = resolved && location ? attachmentMetaOf({ ...resolved, ...location }) : null;
    let bestAttachment = null;
    const citationKeySourceValue = stringField(meta, 'citationKeySource');
    const citationKeySource = citationKeySourceValue === 'native' || citationKeySourceValue === 'extra'
        ? citationKeySourceValue
        : null;
    const keyConflict = isRecord(meta['citationKeyConflict']) ? meta['citationKeyConflict'] : null;
    const citationKeyConflict = keyConflict === null
        ? null
        : (() => {
            const native = stringField(keyConflict, 'native');
            const extra = stringField(keyConflict, 'extra');
            return native === undefined || extra === undefined ? null : { native, extra };
        })();
    const attachment = meta['bestAttachment'];
    if (isRecord(attachment)) {
        const contentType = stringField(attachment, 'contentType');
        if (contentType !== undefined) {
            const ref = stringField(attachment, 'ref');
            bestAttachment = { contentType, ...(ref === undefined ? {} : { ref }) };
        }
    }
    return {
        title: stringField(meta, 'title') ?? null,
        creators: stringField(meta, 'creators') ?? null,
        citationKey: stringField(meta, 'citationKey') ?? null,
        citationKeySource,
        citationKeyConflict,
        year: numberField(meta, 'year') ?? null,
        venue: stringField(meta, 'venue') ?? null,
        bestAttachment,
        resolvedAttachment,
        notes: childCountOf(meta['notes']),
        annotations: childCountOf(meta['annotations']),
        attachments: childCountOf(meta['attachments']),
        notesPreview: childPreviewsOf(meta['notesPreview']),
        annotationsPreview: childPreviewsOf(meta['annotationsPreview']),
        detailOmitted: detailOmittedOf(meta),
    };
}
function decodeSourceAvailability(value) {
    if (!isRecord(value))
        return {};
    const result = {};
    for (const [source, entry] of Object.entries(value)) {
        if (!isRecord(entry))
            continue;
        const requested = boolField(entry, 'requested');
        const unavailable = boolField(entry, 'unavailable');
        const returnedPassages = numberField(entry, 'returnedPassages');
        if (requested === undefined || unavailable === undefined || returnedPassages === undefined)
            continue;
        result[source] = { requested, returnedPassages, unavailable };
    }
    return result;
}
function decodeCoverage(value) {
    if (!isRecord(value))
        return null;
    const complete = boolField(value, 'complete');
    if (complete === undefined)
        return null;
    const indexedPages = numberField(value, 'indexedPages');
    const totalPages = numberField(value, 'totalPages');
    const indexedChars = numberField(value, 'indexedChars');
    const totalChars = numberField(value, 'totalChars');
    return {
        complete,
        ...(indexedPages === undefined ? {} : { indexedPages }),
        ...(totalPages === undefined ? {} : { totalPages }),
        ...(indexedChars === undefined ? {} : { indexedChars }),
        ...(totalChars === undefined ? {} : { totalChars }),
    };
}
/**
 * Decode one retrieve projection into its mode's view. The mode is explicit on
 * current metas; a meta without it predates the fulltext arm and was always
 * evidence, and a stray `fulltextRead` without a mode is still a window fact
 * written by an intermediate build, so the fact itself decides.
 */
export function retrieveMetaOf(meta) {
    const mode = stringField(meta, 'mode');
    if (mode === 'fulltext' || (mode === undefined && meta['fulltextRead'] !== undefined)) {
        const read = fulltextReadOf(meta['fulltextRead']);
        return read === null ? { kind: 'malformed' } : { kind: 'fulltext', fulltextRead: read };
    }
    const truncated = boolField(meta, 'truncated');
    return {
        kind: 'evidence',
        items: evidenceItemsOf(meta),
        count: numberField(meta, 'count') ?? null,
        truncated: truncated === undefined ? null : truncated,
        attachmentRef: stringField(meta, 'attachmentRef') ?? null,
        attachmentContentType: stringField(meta, 'attachmentContentType') ?? null,
        coverage: decodeCoverage(meta['coverage']),
        sourceAvailability: decodeSourceAvailability(meta['sourceAvailability']),
        detailOmitted: detailOmittedOf(meta),
    };
}
export function attachmentMetaOf(meta) {
    const kindValue = stringField(meta, 'kind');
    const kind = kindValue === 'file' || kindValue === 'url' ? kindValue : null;
    return {
        kind,
        title: stringField(meta, 'title') ?? null,
        contentType: stringField(meta, 'contentType') ?? null,
        location: kind === null ? null : (stringField(meta, kind === 'file' ? 'path' : 'url') ?? null),
        ref: stringField(meta, 'ref') ?? null,
        detailOmitted: detailOmittedOf(meta),
    };
}
/**
 * The `zotero_get_batch` projection: rows keyed by ref, and the statuses
 * vector joined onto the request's own refs. The join only reads when the
 * vector matches the requested refs one-to-one; otherwise the rows' own
 * `status` field is all the projection states.
 */
export function getBatchMetaOf(meta, refs) {
    const rawRows = Array.isArray(meta['items']) ? meta['items'] : null;
    const counts = isRecord(meta['counts']) ? meta['counts'] : {};
    const outcomes = new Map();
    const statuses = Array.isArray(meta['statuses']) ? meta['statuses'] : [];
    if (refs.length > 0 && refs.length === statuses.length) {
        refs.forEach((ref, index) => {
            const status = statuses[index];
            if (status === 'ok' || status === 'error')
                outcomes.set(ref, status);
        });
    }
    const rows = new Map();
    if (rawRows !== null) {
        for (const raw of rawRows) {
            if (!isRecord(raw))
                continue;
            const ref = stringField(raw, 'ref');
            if (!ref)
                continue;
            const year = raw['year'];
            rows.set(ref, {
                ref,
                status: outcomes.get(ref) ??
                    (raw['status'] === 'ok' || raw['status'] === 'error' ? raw['status'] : null),
                title: stringField(raw, 'title') ?? null,
                creators: stringField(raw, 'creators') ?? null,
                venue: stringField(raw, 'venue') ?? null,
                year: typeof year === 'number' && Number.isSafeInteger(year) ? year : null,
                bestAttachmentRef: stringField(raw, 'bestAttachmentRef') ?? null,
                bestAttachmentType: stringField(raw, 'bestAttachmentType') ?? null,
                code: stringField(raw, 'code'),
                message: stringField(raw, 'message'),
                citationKey: stringField(raw, 'citationKey'),
            });
        }
    }
    return {
        rows: rawRows === null ? null : rows,
        requested: countField(counts, 'requested') ?? (refs.length || rows.size),
        succeeded: countField(counts, 'succeeded'),
        failed: countField(counts, 'failed'),
        omitted: countField(meta, 'omitted') ?? 0,
        detailOmitted: meta['detailOmitted'] === true,
        outcomes,
        attributedRefs: refs.length > 0 ? refs : [...new Set([...outcomes.keys(), ...rows.keys()])],
    };
}
/**
 * The `zotero_match_references` projection: per input, the selected candidate
 * when the match settled on one, else the listed candidates. A candidate
 * without its ref or title is dropped rather than rendered half.
 */
export function matchReferencesMetaOf(meta, inputCount = 0) {
    const rawItems = meta['items'];
    const omitted = countField(meta, 'omitted') ?? 0;
    const detailOmitted = meta['detailOmitted'] === true;
    const items = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
        if (!isRecord(raw))
            continue;
        const decodeCandidate = (value) => {
            if (!isRecord(value))
                return undefined;
            const ref = stringField(value, 'ref');
            const title = stringField(value, 'title');
            if (!ref || title === undefined)
                return undefined;
            const authors = Array.isArray(value['authors'])
                ? value['authors'].filter((author) => typeof author === 'string')
                : [];
            const year = value['year'];
            const conflict = isRecord(value['citationKeyConflict']) ? value['citationKeyConflict'] : {};
            const native = stringField(conflict, 'native');
            const extra = stringField(conflict, 'extra');
            return {
                ref,
                title,
                authors,
                venue: stringField(value, 'venue') ?? null,
                year: typeof year === 'number' && Number.isSafeInteger(year) ? year : null,
                citationKey: stringField(value, 'citationKey'),
                exportKey: stringField(value, 'exportKey'),
                matchMethod: stringField(value, 'matchMethod'),
                confidence: stringField(value, 'confidence'),
                ...(native && extra ? { citationKeyConflict: { native, extra } } : {}),
            };
        };
        const selected = isRecord(raw['selected'])
            ? [decodeCandidate(raw['selected'])].flatMap((candidate) => candidate === undefined ? [] : [candidate])
            : [];
        const candidates = Array.isArray(raw['candidates'])
            ? raw['candidates']
                .map(decodeCandidate)
                .filter((candidate) => candidate !== undefined)
            : [];
        const status = raw['status'];
        items.push({
            inputId: stringField(raw, 'inputId'),
            status: status === 'matched' ||
                status === 'ambiguous' ||
                status === 'notFound' ||
                status === 'conflict'
                ? status
                : undefined,
            reason: stringField(raw, 'reason'),
            selected,
            candidates,
        });
    }
    const requested = countField(meta, 'requested') ?? (inputCount || items.length + omitted);
    return {
        items: Array.isArray(rawItems) ? items : null,
        requested,
        matched: countField(meta, 'matched') ??
            (Array.isArray(rawItems) &&
                omitted === 0 &&
                !detailOmitted &&
                items.length === requested &&
                items.every(({ status }) => status !== undefined)
                ? items.filter(({ status }) => status === 'matched').length
                : undefined),
        omitted,
        detailOmitted,
    };
}
//# sourceMappingURL=decoders.js.map