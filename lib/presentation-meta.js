/**
 * Card-sized presentation projections for the Zotero tools. Each
 * projector is a pure function of the canonical tool output (plus, for
 * export, the requested ref count) and feeds `output.presentationMeta`, so
 * the projected facts persist into the `tool/result` event's `meta` and
 * reach the browser as `block.meta`, where the dedicated Zotero web view
 * renders from them. A single UTF-8 byte budget bounds the whole projection;
 * over-budget projections drop their detail field and set `detailOmitted`
 * instead of inventing a per-field truncation policy. The complete data stays
 * in the canonical result and the trajectory Inspect.
 * @module dsh-zotero/presentation-meta
 */
import { asJsonValue } from './json.js';
import { formatCreatorsList } from './creators.js';
import { isEvidenceSource } from './evidence-item.js';
import { supportedLibraryOfRef } from './refs.js';
/** UTF-8 byte budget for one tool's presentation meta. */
export const MAX_PRESENTATION_META_BYTES = 8192;
/** Logical caps applied inside each projector before the byte budget. */
export const MAX_PRESENTATION_SEARCH_ROWS = 20;
/** Row-bytes allowance inside the search projection (kept well under the total budget). */
export const MAX_PRESENTATION_SEARCH_ROWS_BYTES = 6144;
const MAX_PRESENTATION_SEARCH_TITLE_CHARS = 120;
const MAX_PRESENTATION_SEARCH_CREATOR_CHARS = 60;
const MAX_PRESENTATION_PREVIEW_CHARS = 200;
const MAX_PRESENTATION_GET_TITLE_CHARS = 200;
const MAX_PRESENTATION_GET_CREATORS_CHARS = 120;
export const MAX_PRESENTATION_GET_VENUE_CHARS = 200;
const MAX_PRESENTATION_PREVIEW_RECORDS = 2;
export const MAX_PRESENTATION_EVIDENCE_CHARS = 400;
const MAX_PRESENTATION_EVIDENCE_PASSAGES = 4;
/** Bounded export-ref entries the projection itemizes; the rest count into `refsOmitted`. */
const MAX_PRESENTATION_EXPORT_REFS = 20;
export const MAX_PRESENTATION_BROWSE_ROWS = 20;
export const MAX_PRESENTATION_BROWSE_ROWS_BYTES = 6144;
const MAX_PRESENTATION_BATCH_ROWS = 20;
function childFacts(value) {
    return {
        total: value.total,
        returned: value.returned,
        ...(value.completeness === undefined ? {} : { completeness: value.completeness }),
        ...(value.offset === undefined ? {} : { offset: value.offset }),
        ...(value.limit === undefined ? {} : { limit: value.limit }),
        ...(value.nextOffset === undefined ? {} : { nextOffset: value.nextOffset }),
    };
}
/** Cut text at a character cap for a card preview. */
function truncateChars(text, cap) {
    return text.length <= cap ? text : text.slice(0, cap);
}
/** Distinct sources in first-seen order. */
function sourcesOf(evidence) {
    const seen = new Set();
    const sources = [];
    for (const entry of evidence) {
        if (!seen.has(entry.source) && isEvidenceSource(entry.source)) {
            seen.add(entry.source);
            // The output schema pins the source vocabulary; the projection reuses it.
            sources.push(entry.source);
        }
    }
    return sources;
}
function libraryOfScope(scope) {
    if (scope.kind === 'library' || scope.kind === 'publications') {
        return scope.library;
    }
    return supportedLibraryOfRef(scope.ref);
}
/** Retain complete browse rows within the card budget; the canonical page stays intact. */
export function projectBrowseMeta(value) {
    const items = [];
    let bytes = 2;
    for (const row of value.items) {
        if (items.length === MAX_PRESENTATION_BROWSE_ROWS)
            break;
        const size = presentationMetaBytes(row) + (items.length === 0 ? 0 : 1);
        if (bytes + size > MAX_PRESENTATION_BROWSE_ROWS_BYTES)
            break;
        items.push(row);
        bytes += size;
    }
    return {
        ...value,
        items,
        displayed: items.length,
        omitted: Math.max(0, value.returned - items.length),
    };
}
/**
 * Project one search result into card-sized facts. Rows are bounded by both
 * a logical cap and a row-bytes allowance, so a normal page projects whole
 * (no arbitrary 6-row cut) while a heavy page still fits the shared budget
 * without ever tripping the detail-dropping overflow.
 * @param value - the canonical search result.
 * @returns the bounded projection.
 */
export function projectSearchMeta(value) {
    const items = [];
    let bytes = 0;
    // Supplemental note rows follow the primary rows in the same bounded list,
    // so the Zotero tab keeps listing note hits without a second list surface.
    for (const item of [...value.items, ...(value.supplemental?.items ?? [])]) {
        if (items.length >= MAX_PRESENTATION_SEARCH_ROWS)
            break;
        const row = {
            ref: item.ref,
            title: truncateChars(item.title, MAX_PRESENTATION_SEARCH_TITLE_CHARS),
            creatorSummary: truncateChars(item.creatorSummary, MAX_PRESENTATION_SEARCH_CREATOR_CHARS),
            ...(item.year === undefined ? {} : { year: item.year }),
            itemType: item.itemType,
            ...(item.citationKey === undefined ? {} : { citationKey: item.citationKey }),
            ...(item.citationKeySource === undefined
                ? {}
                : { citationKeySource: item.citationKeySource }),
            ...(item.citationKeyConflict === undefined
                ? {}
                : { citationKeyConflict: item.citationKeyConflict }),
            ...(item.bestAttachmentRef === undefined
                ? {}
                : { bestAttachmentRef: item.bestAttachmentRef }),
            ...(item.bestAttachmentType === undefined
                ? {}
                : { bestAttachmentType: item.bestAttachmentType }),
        };
        const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
        // The first row always fits; later rows stop once the allowance is spent.
        if (items.length > 0 && bytes + rowBytes > MAX_PRESENTATION_SEARCH_ROWS_BYTES)
            break;
        items.push(row);
        bytes += rowBytes;
    }
    const displayed = items.length;
    const supplementCount = value.supplemental?.items.length ?? 0;
    const library = libraryOfScope(value.scope);
    return {
        returned: value.returned,
        normalizedQuery: value.normalizedQuery ?? '',
        queryWasEmpty: value.queryWasEmpty ?? true,
        ...(value.nextActions === undefined ? {} : { nextActions: value.nextActions }),
        total: value.total,
        nextOffset: value.nextOffset ?? null,
        displayed,
        omitted: value.returned + supplementCount - displayed,
        noteMatches: value.supplemental === undefined ? null : supplementCount,
        items,
        scope: value.scope,
        ...(library === undefined ? {} : { library }),
    };
}
/** One child collection into bounded previews. */
function childPreviews(items) {
    return items.slice(0, MAX_PRESENTATION_PREVIEW_RECORDS).map((item) => ({
        ref: item.ref,
        preview: truncateChars(item.text, MAX_PRESENTATION_PREVIEW_CHARS),
        ...(item.pageLabel === undefined ? {} : { pageLabel: item.pageLabel }),
        ...(item.parentRef === undefined ? {} : { parentRef: item.parentRef }),
    }));
}
function projectBibliographicFacts(item) {
    return {
        title: truncateChars(item.title, MAX_PRESENTATION_GET_TITLE_CHARS),
        creators: truncateChars(formatCreatorsList(item.creators ?? []), MAX_PRESENTATION_GET_CREATORS_CHARS),
        ...(item.year === undefined ? {} : { year: item.year }),
        ...(item.venue === undefined
            ? {}
            : { venue: truncateChars(item.venue, MAX_PRESENTATION_GET_VENUE_CHARS) }),
        ...(item.citationKey === undefined ? {} : { citationKey: item.citationKey }),
        ...(item.citationKeySource === undefined ? {} : { citationKeySource: item.citationKeySource }),
        ...(item.citationKeyConflict === undefined
            ? {}
            : { citationKeyConflict: item.citationKeyConflict }),
    };
}
/**
 * Project one item detail into card-sized facts: the header line, child
 * counts, and (when requested) bounded note/annotation previews kept apart
 * from the item's own metadata.
 * @param value - the canonical item detail.
 * @returns the bounded projection.
 */
export function projectGetMeta(value) {
    return {
        ...(value.location ? { location: value.location } : {}),
        ...(value.bestAttachment?.location ? { resolvedAttachment: value.bestAttachment } : {}),
        ...projectBibliographicFacts(value),
        ...(value.itemType === undefined ? {} : { itemType: value.itemType }),
        ...(value.ref === undefined ? {} : { ref: value.ref }),
        ...(value.notes === undefined ? {} : { notes: childFacts(value.notes) }),
        ...(value.annotations === undefined ? {} : { annotations: childFacts(value.annotations) }),
        ...(value.attachments === undefined ? {} : { attachments: childFacts(value.attachments) }),
        ...(value.bestAttachment === undefined
            ? {}
            : {
                bestAttachment: {
                    contentType: value.bestAttachment.contentType,
                    ...(value.bestAttachment.ref === undefined ? {} : { ref: value.bestAttachment.ref }),
                },
            }),
        notesPreview: value.notes === undefined ? [] : childPreviews(value.notes.items),
        annotationsPreview: value.annotations === undefined ? [] : childPreviews(value.annotations.items),
        ...(value.relations === undefined ? {} : { relations: value.relations }),
    };
}
/** Project bounded per-ref facts for batch read cards and the literature trail. */
export function projectGetBatchMeta(value) {
    // Keep one ordered status per requested ref outside the bounded display
    // rows. The Sources reducer joins this vector to the complete refs argument
    // so every read remains attributable without duplicating long refs.
    const statuses = value.items.map((entry) => entry.status);
    const items = value.items.slice(0, MAX_PRESENTATION_BATCH_ROWS).map((entry) => {
        if (entry.status === 'error') {
            return {
                ref: entry.ref,
                status: entry.status,
                code: entry.code,
                message: truncateChars(entry.message, 180),
            };
        }
        const item = entry.item;
        return {
            ref: entry.ref,
            status: entry.status,
            itemType: item.itemType,
            ...projectBibliographicFacts(item),
            ...(item.bestAttachment?.ref === undefined
                ? {}
                : { bestAttachmentRef: item.bestAttachment.ref }),
            ...(item.bestAttachment?.contentType === undefined
                ? {}
                : { bestAttachmentType: item.bestAttachment.contentType }),
        };
    });
    return boundedPresentationMeta({ counts: value.counts, statuses, items, omitted: value.items.length - items.length }, ['items']);
}
/** Project compact reconciliation rows; the canonical result retains every candidate and diff. */
export function projectMatchReferencesMeta(value) {
    const matched = value.items.filter((item) => item.status === 'matched').length;
    const items = value.items.slice(0, MAX_PRESENTATION_BATCH_ROWS).map((item) => ({
        inputId: item.inputId,
        status: item.status,
        ...(item.reason === undefined ? {} : { reason: item.reason }),
        ...(item.bibKey === undefined ? {} : { bibKey: item.bibKey }),
        ...(item.selected === undefined ? {} : { selected: item.selected }),
        ...(item.candidates === undefined ? {} : { candidates: item.candidates.slice(0, 3) }),
        ...(item.fieldDiff === undefined ? {} : { fieldDiff: item.fieldDiff }),
    }));
    return boundedPresentationMeta({ requested: value.items.length, matched, items, omitted: value.items.length - items.length }, ['items']);
}
/**
 * Project one retrieval result into card-sized facts, one arm per mode. The
 * evidence arm copies passages and derives per-source availability from the
 * canonical result alone (`requested` is the caller's source list,
 * `unavailable` the skipped list, `returnedPassages` the evidence count per
 * source). The fulltext arm carries only the window fact: that mode has no
 * evidence sources, no passage budget, and no query, so none of those keys
 * exist on it.
 * @param value - the canonical retrieval result.
 * @param requestedSources - the evidence sources the call asked for.
 * @returns the bounded projection for the result's mode.
 */
export function projectRetrieveMeta(value, requestedSources) {
    if (value.mode === 'fulltext') {
        const read = value.fulltext;
        return {
            mode: 'fulltext',
            fulltextRead: {
                sourceKind: read.sourceKind,
                ...(read.item === undefined
                    ? {}
                    : {
                        item: {
                            ...read.item,
                            title: truncateChars(read.item.title, MAX_PRESENTATION_GET_TITLE_CHARS),
                            creatorSummary: truncateChars(read.item.creatorSummary, MAX_PRESENTATION_GET_CREATORS_CHARS),
                            ...(read.item.venue === undefined
                                ? {}
                                : { venue: truncateChars(read.item.venue, MAX_PRESENTATION_GET_VENUE_CHARS) }),
                        },
                    }),
                ...(read.attachmentContentType === undefined
                    ? {}
                    : { attachmentContentType: read.attachmentContentType }),
                sourceLabel: read.sourceLabel,
                textFormat: read.textFormat,
                ...(read.artifact === undefined ? {} : { artifact: read.artifact }),
                ...(read.coverage === undefined ? {} : { coverage: read.coverage }),
                totalChars: read.totalChars,
                inputTruncated: read.inputTruncated,
                start: read.start,
                end: read.end,
                isTruncated: read.isTruncated,
                spillAvailable: read.spillAvailable,
                ...(read.attachmentRef === undefined ? {} : { attachmentRef: read.attachmentRef }),
            },
        };
    }
    const items = value.evidence.slice(0, MAX_PRESENTATION_EVIDENCE_PASSAGES).map((entry) => {
        const preview = truncateChars(entry.text, MAX_PRESENTATION_EVIDENCE_CHARS);
        return {
            source: entry.source,
            sourceRef: entry.sourceRef,
            preview,
            previewTruncated: entry.text.length > preview.length,
            ...(entry.source !== 'fulltext'
                ? {}
                : {
                    ...(entry.textFormat === undefined ? {} : { textFormat: entry.textFormat }),
                    ...(entry.artifact === undefined ? {} : { artifact: entry.artifact }),
                    ...(entry.start === undefined || entry.end === undefined
                        ? {}
                        : { start: entry.start, end: entry.end }),
                }),
            matchKind: entry.matchKind,
            ...(entry.pageLabel === undefined ? {} : { pageLabel: entry.pageLabel }),
            ...(entry.attachmentRef === undefined ? {} : { attachmentRef: entry.attachmentRef }),
            ...(entry.matchedFields === undefined
                ? {}
                : { matchedFields: [...entry.matchedFields] }),
        };
    });
    const skipped = new Set(value.sourcesSkipped);
    const sourceAvailability = {};
    for (const source of requestedSources) {
        sourceAvailability[source] = {
            requested: true,
            returnedPassages: value.evidence.filter((entry) => entry.source === source).length,
            unavailable: skipped.has(source),
        };
    }
    return {
        mode: 'evidence',
        count: value.evidence.length,
        sources: sourcesOf(value.evidence),
        truncated: value.truncated,
        sourcesSkipped: [...value.sourcesSkipped],
        items,
        ...(value.attachmentRef === undefined ? {} : { attachmentRef: value.attachmentRef }),
        ...(value.attachmentContentType === undefined
            ? {}
            : { attachmentContentType: value.attachmentContentType }),
        ...(value.coverage === undefined ? {} : { coverage: value.coverage }),
        sourceAvailability,
    };
}
/**
 * Project one export result into card-sized facts. The citation arm counts
 * the actually exported citations; the text formats are opaque joined text,
 * so they report the requested ref count instead of inventing an item count.
 * The exported ref list is itemized up to {@link MAX_PRESENTATION_EXPORT_REFS}
 * entries, and the translator formats carry their per-document items (ref,
 * key, and title, never the entry text) in the same bound. The byte-budget
 * guard may drop them entirely (see `boundedPresentationMeta`), never part
 * of it.
 * @param value - the canonical export result.
 * @param refs - the exported refs, in the caller's order; their count is the request size.
 * @returns the bounded projection.
 */
export function projectExportMeta(value, refs) {
    const base = {
        format: value.format,
        requested: refs.length,
        ...(value.style === undefined
            ? {}
            : { style: truncateChars(value.style, MAX_PRESENTATION_GET_TITLE_CHARS) }),
        ...(value.locale === undefined
            ? {}
            : { locale: truncateChars(value.locale, MAX_PRESENTATION_GET_TITLE_CHARS) }),
        refs: [...refs.slice(0, MAX_PRESENTATION_EXPORT_REFS)],
        refsOmitted: Math.max(0, refs.length - MAX_PRESENTATION_EXPORT_REFS),
    };
    if (value.format === 'citation') {
        return { ...base, count: value.citations?.length ?? 0 };
    }
    if (value.items === undefined)
        return base;
    const items = value.items
        .slice(0, MAX_PRESENTATION_EXPORT_REFS)
        .map((item) => {
        const base = {
            ref: item.ref,
            ...(item.exportKey === undefined ? {} : { exportKey: item.exportKey }),
            ...(item.citationKey === undefined ? {} : { citationKey: item.citationKey }),
            ...(item.citationKeySource === undefined
                ? {}
                : { citationKeySource: item.citationKeySource }),
            ...(item.citationKeyConflict === undefined
                ? {}
                : { citationKeyConflict: item.citationKeyConflict }),
            ...(item.title === undefined ? {} : { title: item.title }),
            ...(item.entryIndex === undefined ? {} : { entryIndex: item.entryIndex }),
        };
        return item.start === undefined || item.end === undefined
            ? base
            : { ...base, start: item.start, end: item.end };
    });
    return { ...base, items };
}
/** The UTF-8 byte size of one JSON projection. */
export function presentationMetaBytes(meta) {
    const encoded = JSON.stringify(meta);
    return encoded === undefined ? 0 : new TextEncoder().encode(encoded).byteLength;
}
/**
 * Enforce the shared byte budget. A projection that fits returns unchanged;
 * an over-budget one drops its detail keys (keeping the summary facts) and
 * records `detailOmitted`. If summary fields alone exceed the budget, retain
 * complete fields that fit, prioritizing scalar counts and flags. Full values
 * stay in the canonical result; identities and strings are never cut in half.
 * @param meta - one projector's output.
 * @param detailKeys - the keys holding per-item detail rows or long values.
 * @returns the bounded projection.
 */
export function boundedPresentationMeta(meta, detailKeys) {
    if (presentationMetaBytes(meta) <= MAX_PRESENTATION_META_BYTES)
        return meta;
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta))
        return { detailOmitted: true };
    const record = meta;
    const reduced = { detailOmitted: true };
    for (const [key, value] of Object.entries(record)) {
        const json = asJsonValue(value);
        if (key !== 'detailOmitted' && !detailKeys.includes(key) && json !== undefined)
            reduced[key] = json;
    }
    if (presentationMetaBytes(reduced) > MAX_PRESENTATION_META_BYTES) {
        const bounded = { detailOmitted: true };
        const entries = Object.entries(reduced).sort((left, right) => {
            const scalar = (value) => value === null || typeof value === 'number' || typeof value === 'boolean';
            return Number(scalar(right[1])) - Number(scalar(left[1]));
        });
        for (const [key, value] of entries) {
            bounded[key] = value;
            if (presentationMetaBytes(bounded) > MAX_PRESENTATION_META_BYTES)
                delete bounded[key];
        }
        return bounded;
    }
    // Structural widening only: every kept value already entered through a
    // JsonValue-typed projector; TypeScript has no index-signature way to
    // express Record<string, JsonValue> assignability from Record<string,
    // unknown>, so this one narrowing-by-construction cast is documented here
    // rather than spread across every projector.
    return reduced;
}
//# sourceMappingURL=presentation-meta.js.map